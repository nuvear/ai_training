import { z } from 'zod';
import type { Tier } from '../types';
import type { ToolDefinition } from '../types';
import { NotFoundError, InvalidStateError } from '@/server/domain/errors';
import { getPaymentProvider } from '@/server/payments';
import { applyRefundToOrder } from '@/server/domain/fulfillment';

// refund.execute (COPILOT_TOOLS §4) — DYNAMIC tier:
//   approve  when amount ≤ ¥10,000 (JPY)  [staff or owner may approve]
//   owner_only above the threshold        [owner only]
// (PRODUCT_SPEC §7). USD refunds use the yen-equivalent threshold so the same
// boundary holds across currencies. The tier is computed server-side from the
// PARSED input (see ledger.effectiveTier) and recomputed at approval time — a
// caller cannot escalate or lower it.

/** JPY threshold; at or below is approve-tier, above is owner-only. */
export const REFUND_APPROVE_THRESHOLD_JPY = 10_000;
/** Rough USD-cents equivalent of ¥10,000 for tiering (not an FX rate for money). */
export const REFUND_APPROVE_THRESHOLD_USD = 10_000; // ¥10,000 ≈ $100.00 = 10000 cents

const refundInput = z.object({
  paymentId: z.string().uuid(),
  /** refund amount in the payment's minor units (JPY yen / USD cents). */
  amount: z.number().int().positive(),
  /** currency of the amount — carried on the input so the tier is a pure
   * function of the request; the handler re-checks it against the real payment. */
  currency: z.enum(['JPY', 'USD']),
  reason: z.string().trim().min(1).max(500),
});
type RefundInput = z.infer<typeof refundInput>;

/** Pure tier function of the parsed input — the single source for both the
 * stored ledger tier and the approval gate. */
export function refundTier(input: RefundInput): Tier {
  const threshold =
    input.currency === 'JPY' ? REFUND_APPROVE_THRESHOLD_JPY : REFUND_APPROVE_THRESHOLD_USD;
  return input.amount > threshold ? 'owner_only' : 'approve';
}

export const refundExecute: ToolDefinition<
  RefundInput,
  { refundId: string; providerStatus: string; orderStatus: string }
> = {
  name: 'refund.execute',
  tier: 'approve', // baseline; dynamicTier raises it above the threshold
  dynamicTier: refundTier,
  surfaces: ['copilot'],
  input: refundInput,
  summarize: (i) => ({
    en: `Refund ${i.currency === 'JPY' ? '¥' : '$'}${i.amount.toLocaleString('en')} — ${i.reason}`,
    ja: `${i.currency === 'JPY' ? '¥' : '$'}${i.amount.toLocaleString('ja')} を返金：${i.reason}`,
  }),
  handler: async (ctx, i) => {
    const payment = await ctx.tx.payment.findUnique({
      where: { id: i.paymentId },
      include: { order: true, refunds: true },
    });
    if (!payment) throw new NotFoundError('Payment', i.paymentId);
    if (payment.status !== 'succeeded' && payment.status !== 'refunded') {
      throw new InvalidStateError('Only a succeeded payment can be refunded');
    }
    // Server re-validates the declared currency against the real order.
    if (payment.order.currency !== i.currency) {
      throw new InvalidStateError('Refund currency does not match the order');
    }
    const alreadyRefunded = payment.refunds.reduce((s, r) => s + r.amount, 0);
    if (alreadyRefunded + i.amount > payment.amount) {
      throw new InvalidStateError('Refund exceeds the remaining refundable amount');
    }

    // Call the provider first; store its refund reference on our Refund row.
    const provider = getPaymentProvider();
    const result = await provider.createRefund({
      providerRef: payment.providerRef,
      amountMinor: i.amount,
      currency: i.currency,
      reason: i.reason,
    });

    const refund = await ctx.tx.refund.create({
      data: {
        paymentId: payment.id,
        amount: i.amount,
        reason: i.reason,
        approvedBy: ctx.session.userId,
        providerRef: result.providerRef,
        aiActionId: ctx.actionId, // ties the refund to its ledger row (spec §7)
      },
    });

    // Reflect settlement immediately when the provider confirms synchronously
    // (mock returns 'succeeded'); async providers finalize via refund.succeeded.
    if (result.status === 'succeeded') {
      const totalRefunded = alreadyRefunded + i.amount;
      if (totalRefunded >= payment.amount) {
        await ctx.tx.payment.update({ where: { id: payment.id }, data: { status: 'refunded' } });
      }
      await applyRefundToOrder(ctx.tx, payment.orderId);
    }

    const order = await ctx.tx.order.findUnique({ where: { id: payment.orderId } });
    return {
      refundId: refund.id,
      providerStatus: result.status,
      orderStatus: order?.status ?? payment.order.status,
    };
  },
};

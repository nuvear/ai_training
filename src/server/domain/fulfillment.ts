import 'server-only';
import type { Prisma } from '@/generated/prisma';
import { prisma } from '@/server/db/client';
import { sendMail } from '@/server/email/send';
import { formatJpy, formatUsd } from '@/lib/format';

// ─────────────────────────────────────────────────────────────────────────────
// Order fulfillment — the state machine driven by payment confirmation. Invoked
// by the Airwallex webhook (card / konbini) and by invoice.mark_paid (振込 bank
// transfer reconciliation). Both call the SAME functions: UI, webhook and tools
// never fork fulfillment logic. Every step is idempotent so a webhook replay
// cannot double-fulfill (PRODUCT_SPEC §9; the provider_ref unique guard is the
// primary anchor, this layer is the secondary guard).
//
// Runs OUTSIDE tenant RLS: the webhook has no user session, and fulfillment must
// cross the buyer/org boundary (create an enrollment for the buyer, activate an
// org's seat pool). It uses the base prisma client in an explicit transaction.
// ─────────────────────────────────────────────────────────────────────────────

/** Formats an order total for the receipt email in the buyer's locale. */
function formatMoney(currency: 'JPY' | 'USD', minor: number, locale: string): string {
  return currency === 'JPY' ? formatJpy(minor, locale) : formatUsd(minor);
}

/**
 * Fulfill a paid order: create the enrollment (individual) or activate the seat
 * pool (B2B). Idempotent — safe to call again for an already-fulfilled order.
 * Runs inside the caller's transaction so it commits atomically with the Payment
 * / Order status change.
 */
export async function fulfillOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: true, seatPool: true },
  });
  if (!order) return;

  if (order.kind === 'individual_enrollment') {
    const cohortId = order.items.find((i) => i.cohortId)?.cohortId;
    if (!cohortId) return;
    // upsert on the (user, cohort) unique key → replay-safe, no double enrollment.
    await tx.enrollment.upsert({
      where: { userId_cohortId: { userId: order.buyerUserId, cohortId } },
      update: {},
      create: {
        userId: order.buyerUserId,
        cohortId,
        source: 'self_paid',
        status: 'active',
      },
    });
  } else if (order.kind === 'seat_pool') {
    // Seat pool is created up-front (seatpool.create_offer) or here on first pay.
    if (order.seatPool) {
      if (order.seatPool.status !== 'active') {
        await tx.seatPool.update({
          where: { id: order.seatPool.id },
          data: { status: 'active' },
        });
      }
    } else {
      const spec = order.items[0]?.seatPoolSpec as {
        organizationId?: string;
        seats?: number;
        validUntil?: string;
      } | null;
      if (spec?.organizationId && spec.seats) {
        await tx.seatPool.create({
          data: {
            organizationId: spec.organizationId,
            orderId: order.id,
            seatsTotal: spec.seats,
            validUntil: spec.validUntil ? new Date(spec.validUntil) : farFuture(),
            status: 'active',
          },
        });
      }
    }
  }
}

function farFuture(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

/** Send the bilingual receipt after fulfillment. Non-transactional (email is a
 * side effect); best-effort, never blocks the 200 response. */
export async function sendReceipt(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { buyer: true },
  });
  if (!order) return;

  const to = order.buyer.email;
  const localeRaw = order.buyer.locale;
  const short = order.id.slice(0, 8);
  const total = formatMoney(order.currency, order.total, localeRaw);

  const subject =
    localeRaw === 'ja'
      ? `【WorkshopOS】お支払い完了のご案内（注文 ${short}）`
      : `WorkshopOS receipt — order ${short}`;

  // Both locales in the body regardless of preference (bilingual receipts).
  const text = [
    `WorkshopOS — Payment received`,
    ``,
    `Order: ${short}`,
    `Total: ${total}`,
    `Thank you for your purchase.`,
    ``,
    `— — —`,
    ``,
    `WorkshopOS — お支払いを受領しました`,
    ``,
    `注文番号：${short}`,
    `合計：${total}`,
    `ご購入ありがとうございます。`,
  ].join('\n');

  await sendMail({ to, subject, text });
}

/** After a refund settles, move the order to refunded / partially_refunded based
 * on the sum of succeeded refunds vs. the order total. Idempotent. */
export async function applyRefundToOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { payments: { include: { refunds: true } } },
  });
  if (!order) return;

  const refunded = order.payments.flatMap((p) => p.refunds).reduce((sum, r) => sum + r.amount, 0);

  const status =
    refunded >= order.total ? 'refunded' : refunded > 0 ? 'partially_refunded' : order.status;
  if (status !== order.status) {
    await tx.order.update({ where: { id: orderId }, data: { status } });
  }
}

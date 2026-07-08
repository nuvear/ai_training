import { z } from 'zod';
import type { ToolDefinition } from '../types';
import { NotFoundError } from '@/server/domain/errors';
import { sendReceipt } from '@/server/domain/fulfillment';

// Commerce read/receipt tools (COPILOT_TOOLS §4). Both are `auto` and safe.

const lookupInput = z.object({
  // natural-language query or an order id; we resolve an id when it looks like one.
  query: z.string().trim().min(1),
});
type LookupInput = z.infer<typeof lookupInput>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const orderLookup: ToolDefinition<
  LookupInput,
  { orders: Array<{ id: string; status: string; currency: string; total: number }> }
> = {
  name: 'order.lookup',
  tier: 'auto',
  surfaces: ['copilot'],
  input: lookupInput,
  summarize: (i) => ({
    en: `Look up order "${i.query}"`,
    ja: `注文「${i.query}」を検索`,
  }),
  handler: async (ctx, i) => {
    // Untrusted text is data: used only as a literal id/email filter, never SQL.
    const q = i.query.trim();
    const where = UUID_RE.test(q)
      ? { id: q }
      : { buyer: { email: { equals: q, mode: 'insensitive' as const } } };
    const orders = await ctx.tx.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, status: true, currency: true, total: true },
    });
    return { orders };
  },
};

const receiptInput = z.object({ orderId: z.string().uuid() });
type ReceiptInput = z.infer<typeof receiptInput>;

export const orderResendReceipt: ToolDefinition<ReceiptInput, { orderId: string; sent: boolean }> =
  {
    name: 'order.resend_receipt',
    tier: 'auto',
    surfaces: ['copilot'],
    input: receiptInput,
    summarize: (i) => ({
      en: `Resend the receipt for order ${i.orderId.slice(0, 8)}`,
      ja: `注文 ${i.orderId.slice(0, 8)} の領収書を再送`,
    }),
    handler: async (ctx, i) => {
      const order = await ctx.tx.order.findUnique({ where: { id: i.orderId } });
      if (!order) throw new NotFoundError('Order', i.orderId);
      await sendReceipt(i.orderId);
      return { orderId: i.orderId, sent: true };
    },
  };

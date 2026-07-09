import { z } from 'zod';
import type { ToolDefinition } from '../types';
import { NotFoundError } from '@/server/domain/errors';
import { computeOrderTotals } from '@/server/domain/commerce';

// seatpool.create_offer (COPILOT_TOOLS §4) — owner-only B2B contract terms.
// Creates a seat_pool Order (awaiting_transfer) + a not-yet-active SeatPool + an
// Invoice, so the org can pay by 銀行振込 and have seats activate on reconciliation
// via invoice.mark_paid. Money is computed server-side (10% tax on JPY).
//
// NOTE (docs/DECISIONS.md): InvoiceStatus has no `awaiting_transfer` value, so
// the *order* carries `awaiting_transfer` and the invoice is `issued` (its own
// unpaid state). The seat pool starts non-active and flips to `active` on payment.

const offerInput = z.object({
  organizationId: z.string().uuid(),
  seats: z.number().int().positive(),
  /** price PER SEAT in minor units of `currency`. */
  pricePerSeat: z.number().int().nonnegative(),
  currency: z.enum(['JPY', 'USD']).default('JPY'),
  /** ISO date the pool is valid until (e.g. 12 months out). */
  validUntil: z.string().datetime(),
  dueInDays: z.number().int().positive().max(180).default(30),
});
type OfferInput = z.infer<typeof offerInput>;

export const seatpoolCreateOffer: ToolDefinition<
  OfferInput,
  { orderId: string; seatPoolId: string; invoiceId: string; total: number }
> = {
  name: 'seatpool.create_offer',
  tier: 'owner_only',
  surfaces: ['copilot'],
  input: offerInput,
  summarize: (i) => ({
    en: `Offer ${i.seats} seats to org ${i.organizationId.slice(0, 8)}`,
    ja: `組織 ${i.organizationId.slice(0, 8)} に ${i.seats} 席を提案`,
  }),
  handler: async (ctx, i) => {
    const org = await ctx.tx.organization.findUnique({ where: { id: i.organizationId } });
    if (!org) throw new NotFoundError('Organization', i.organizationId);

    const totals = computeOrderTotals({
      items: [{ unitPrice: i.pricePerSeat, qty: i.seats }],
      currency: i.currency,
    });

    // The owner is the buyer-of-record for the B2B offer; billing is the org's.
    const order = await ctx.tx.order.create({
      data: {
        buyerUserId: ctx.session.userId,
        organizationId: i.organizationId,
        kind: 'seat_pool',
        status: 'awaiting_transfer',
        currency: i.currency,
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        total: totals.total,
      },
    });

    await ctx.tx.orderItem.create({
      data: {
        orderId: order.id,
        seatPoolSpec: {
          organizationId: i.organizationId,
          seats: i.seats,
          unitPrice: i.pricePerSeat,
          validUntil: i.validUntil,
        },
        qty: i.seats,
        unitPrice: i.pricePerSeat,
      },
    });

    // Seat pool exists but is NOT active until payment is reconciled. The
    // SeatPoolStatus enum has no "pending" value (active|exhausted|expired|
    // cancelled), so we use `cancelled` as the inactive/unfunded state; the
    // fulfillment path (invoice.mark_paid → fulfillOrder) flips it to `active`
    // on payment. Recorded in docs/DECISIONS.md.
    const seatPool = await ctx.tx.seatPool.create({
      data: {
        organizationId: i.organizationId,
        orderId: order.id,
        seatsTotal: i.seats,
        validUntil: new Date(i.validUntil),
        status: 'cancelled',
      },
    });

    // Sequential invoice number (same allocator as invoice.issue).
    await ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(74657374)`;
    const rows = await ctx.tx.$queryRaw<Array<{ max: number | null }>>`
      SELECT MAX(CAST(SUBSTRING(number FROM 'INV-([0-9]+)') AS INTEGER)) AS max
      FROM invoice
      WHERE number ~ '^INV-[0-9]+$'
    `;
    const number = `INV-${String((rows[0]?.max ?? 0) + 1).padStart(6, '0')}`;
    const dueAt = new Date(Date.now() + i.dueInDays * 24 * 60 * 60 * 1000);

    const invoice = await ctx.tx.invoice.create({
      data: {
        organizationId: i.organizationId,
        orderId: order.id,
        number,
        qualifiedInvoiceNo: process.env.QUALIFIED_INVOICE_NO || null,
        pdfStorageKey: `invoices/${number}.pdf`,
        dueAt,
        status: 'issued',
      },
    });

    return {
      orderId: order.id,
      seatPoolId: seatPool.id,
      invoiceId: invoice.id,
      total: totals.total,
    };
  },
};

import { z } from 'zod';
import type { Prisma } from '@/generated/prisma';
import type { ToolDefinition } from '../types';
import { NotFoundError, InvalidStateError } from '@/server/domain/errors';
import { fulfillOrder } from '@/server/domain/fulfillment';

// Invoicing tools (COPILOT_TOOLS §4) for the B2B 請求書・銀行振込 path.

/** Allocate the next sequential invoice number atomically. A transaction-scoped
 * advisory lock serializes concurrent issuers so no two invoices collide on the
 * `number` unique column, then we derive the next value from the current max.
 * Format: INV-000001 (zero-padded, monotonically increasing). */
async function nextInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  // 74657374 is an arbitrary fixed key ("test"); any constant works — it only
  // needs to be the same across issuers so they serialize on the same lock.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(74657374)`;
  const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
    SELECT MAX(CAST(SUBSTRING(number FROM 'INV-([0-9]+)') AS INTEGER)) AS max
    FROM invoice
    WHERE number ~ '^INV-[0-9]+$'
  `;
  const next = (rows[0]?.max ?? 0) + 1;
  return `INV-${String(next).padStart(6, '0')}`;
}

const issueInput = z.object({
  orderId: z.string().uuid(),
  /** days until due; JP bank-transfer invoices default to 30 days. */
  dueInDays: z.number().int().positive().max(180).default(30),
});
type IssueInput = z.infer<typeof issueInput>;

export const invoiceIssue: ToolDefinition<
  IssueInput,
  { invoiceId: string; number: string; qualifiedInvoiceNo: string | null }
> = {
  name: 'invoice.issue',
  tier: 'approve',
  surfaces: ['copilot'],
  input: issueInput,
  summarize: (i) => ({
    en: `Issue a 請求書 for order ${i.orderId.slice(0, 8)}`,
    ja: `注文 ${i.orderId.slice(0, 8)} の請求書を発行`,
  }),
  handler: async (ctx, i) => {
    const order = await ctx.tx.order.findUnique({
      where: { id: i.orderId },
      include: { invoice: true },
    });
    if (!order) throw new NotFoundError('Order', i.orderId);
    if (!order.organizationId) {
      throw new InvalidStateError('Only organization orders can be invoiced');
    }
    if (order.invoice) {
      // Idempotent-ish: an order already has at most one invoice (unique orderId).
      return {
        invoiceId: order.invoice.id,
        number: order.invoice.number,
        qualifiedInvoiceNo: order.invoice.qualifiedInvoiceNo,
      };
    }

    const number = await nextInvoiceNumber(ctx.tx);
    // 適格請求書 registration number — blank-safe until the owner supplies it.
    const qualifiedInvoiceNo = process.env.QUALIFIED_INVOICE_NO || null;
    const dueAt = new Date(Date.now() + i.dueInDays * 24 * 60 * 60 * 1000);

    const invoice = await ctx.tx.invoice.create({
      data: {
        organizationId: order.organizationId,
        orderId: order.id,
        number,
        qualifiedInvoiceNo,
        // PDF rendering deferred — store a deterministic key now; the render job
        // (M3) writes the bilingual PDF to this key. Noted in docs/DECISIONS.md.
        pdfStorageKey: `invoices/${number}.pdf`,
        dueAt,
        status: 'issued',
      },
    });

    // The order awaits the bank transfer once an invoice is out.
    if (order.status === 'pending') {
      await ctx.tx.order.update({
        where: { id: order.id },
        data: { status: 'awaiting_transfer' },
      });
    }

    return { invoiceId: invoice.id, number, qualifiedInvoiceNo };
  },
};

const markPaidInput = z.object({
  invoiceId: z.string().uuid(),
  /** bank-transfer reference the owner reconciled against. */
  paymentRef: z.string().trim().min(1),
});
type MarkPaidInput = z.infer<typeof markPaidInput>;

export const invoiceMarkPaid: ToolDefinition<
  MarkPaidInput,
  { invoiceId: string; orderId: string; status: string }
> = {
  name: 'invoice.mark_paid',
  tier: 'approve',
  surfaces: ['copilot'],
  input: markPaidInput,
  summarize: (i) => ({
    en: `Reconcile invoice ${i.invoiceId.slice(0, 8)} as paid`,
    ja: `請求書 ${i.invoiceId.slice(0, 8)} の入金を消し込み`,
  }),
  handler: async (ctx, i) => {
    const invoice = await ctx.tx.invoice.findUnique({
      where: { id: i.invoiceId },
      include: { order: true },
    });
    if (!invoice) throw new NotFoundError('Invoice', i.invoiceId);

    if (invoice.status !== 'paid') {
      await ctx.tx.invoice.update({ where: { id: invoice.id }, data: { status: 'paid' } });
    }

    // Record a bank_transfer Payment (idempotent on provider_ref) + mark order paid.
    const providerRef = `bank:${i.paymentRef}`;
    await ctx.tx.payment.upsert({
      where: { providerRef },
      update: { status: 'succeeded', receivedAt: new Date() },
      create: {
        orderId: invoice.orderId,
        provider: 'bank_transfer',
        providerRef,
        status: 'succeeded',
        amount: invoice.order.total,
        receivedAt: new Date(),
      },
    });

    if (invoice.order.status !== 'paid') {
      await ctx.tx.order.update({ where: { id: invoice.orderId }, data: { status: 'paid' } });
    }
    // Activate the seat pool / create the enrollment (same fulfillment path).
    await fulfillOrder(ctx.tx, invoice.orderId);

    return { invoiceId: invoice.id, orderId: invoice.orderId, status: 'paid' };
  },
};

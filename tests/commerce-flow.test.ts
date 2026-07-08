import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import { proposeAction, approveAndExecute } from '@/server/ai/ledger';
import type { SessionUser } from '@/server/auth/session';

// End-to-end B2B seat-pool path via the tools: seatpool.create_offer (owner) →
// invoice.issue numbering → invoice.mark_paid activates the pool. Also verifies
// sequential invoice numbering is monotonic.

const owner: SessionUser = {
  userId: randomUUID(),
  email: `cf-owner-${randomUUID()}@t.local`,
  role: 'owner',
  organizationId: null,
  locale: 'ja',
  name: {},
};

const orgId = randomUUID();

beforeAll(async () => {
  await prisma.user.create({ data: { id: owner.userId, email: owner.email, role: 'owner' } });
  await prisma.organization.create({
    data: {
      id: orgId,
      name: { en: 'Acme', ja: 'アクメ' },
      billingEmail: `org-${randomUUID()}@t.local`,
    },
  });
});

afterAll(async () => {
  const orders = await prisma.order.findMany({
    where: { organizationId: orgId },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  await prisma.enrollment.deleteMany({ where: { seatPool: { organizationId: orgId } } });
  await prisma.invoice.deleteMany({ where: { organizationId: orgId } });
  await prisma.seatPool.deleteMany({ where: { organizationId: orgId } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  // ai_action is append-only (DB trigger); leave the ledger rows, drop the user.
  await prisma.user.deleteMany({ where: { id: owner.userId } });
});

async function runApprove(toolName: string, input: unknown) {
  const proposed = await proposeAction(owner, { surface: 'copilot', toolName, input });
  const executed = await approveAndExecute(owner, proposed.id);
  expect(executed.status).toBe('executed');
  return executed.output as Record<string, unknown>;
}

describe('B2B seat-pool offer → invoice → reconciliation', () => {
  it('creates a seat_pool order, inactive pool and an issued invoice with tax', async () => {
    const out = await runApprove('seatpool.create_offer', {
      organizationId: orgId,
      seats: 10,
      pricePerSeat: 40_000,
      currency: 'JPY',
      validUntil: new Date(Date.now() + 365 * 864e5).toISOString(),
    });
    expect(out.total).toBe(440_000); // 10×40,000 = 400,000 +10% tax

    const order = await prisma.order.findUnique({ where: { id: out.orderId as string } });
    expect(order?.status).toBe('awaiting_transfer');
    expect(order?.tax).toBe(40_000);

    const pool = await prisma.seatPool.findUnique({ where: { id: out.seatPoolId as string } });
    expect(pool?.status).not.toBe('active'); // not funded yet
    expect(pool?.seatsTotal).toBe(10);

    const invoice = await prisma.invoice.findUnique({ where: { id: out.invoiceId as string } });
    expect(invoice?.number).toMatch(/^INV-\d{6}$/);
    expect(invoice?.status).toBe('issued');
  });

  it('invoice.mark_paid flips the order to paid and activates the seat pool', async () => {
    const out = await runApprove('seatpool.create_offer', {
      organizationId: orgId,
      seats: 5,
      pricePerSeat: 30_000,
      currency: 'JPY',
      validUntil: new Date(Date.now() + 365 * 864e5).toISOString(),
    });

    await runApprove('invoice.mark_paid', {
      invoiceId: out.invoiceId,
      paymentRef: `FT-${randomUUID().slice(0, 8)}`,
    });

    const order = await prisma.order.findUnique({ where: { id: out.orderId as string } });
    expect(order?.status).toBe('paid');
    const pool = await prisma.seatPool.findUnique({ where: { id: out.seatPoolId as string } });
    expect(pool?.status).toBe('active');
    const invoice = await prisma.invoice.findUnique({ where: { id: out.invoiceId as string } });
    expect(invoice?.status).toBe('paid');
    const payment = await prisma.payment.findFirst({ where: { orderId: out.orderId as string } });
    expect(payment?.provider).toBe('bank_transfer');
    expect(payment?.status).toBe('succeeded');
  });

  it('assigns strictly increasing sequential invoice numbers', async () => {
    const a = await runApprove('seatpool.create_offer', {
      organizationId: orgId,
      seats: 1,
      pricePerSeat: 10_000,
      currency: 'JPY',
      validUntil: new Date(Date.now() + 365 * 864e5).toISOString(),
    });
    const b = await runApprove('seatpool.create_offer', {
      organizationId: orgId,
      seats: 1,
      pricePerSeat: 10_000,
      currency: 'JPY',
      validUntil: new Date(Date.now() + 365 * 864e5).toISOString(),
    });
    const ia = await prisma.invoice.findUnique({ where: { id: a.invoiceId as string } });
    const ib = await prisma.invoice.findUnique({ where: { id: b.invoiceId as string } });
    const na = Number(ia!.number.replace('INV-', ''));
    const nb = Number(ib!.number.replace('INV-', ''));
    expect(nb).toBe(na + 1);
  });
});

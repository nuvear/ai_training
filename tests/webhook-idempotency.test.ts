import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db/client';
import { buildSignedWebhook } from '@/server/payments/mock';
import { resetPaymentProvider } from '@/server/payments';

// A signed payment.succeeded webhook posted twice must fulfill EXACTLY once:
// one Enrollment, one succeeded Payment — the provider_ref unique column is the
// idempotency anchor (PRODUCT_SPEC §9 / DATA_MODEL §8).

const TEST_SECRET = 'whsec_test_' + randomUUID();

// The mock provider is selected when AIRWALLEX_API_KEY is empty; ensure that and
// set the webhook secret before the route module resolves the provider.
delete process.env.AIRWALLEX_API_KEY;
process.env.AIRWALLEX_WEBHOOK_SECRET = TEST_SECRET;
resetPaymentProvider();

const ids = {
  buyer: randomUUID(),
  workshop: randomUUID(),
  cohort: randomUUID(),
  order: randomUUID(),
  payment: randomUUID(),
};
const providerRef = `mock_pi_${ids.order}`;

let POST: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/webhooks/airwallex/route'));

  await prisma.user.create({
    data: {
      id: ids.buyer,
      email: `buyer-${randomUUID()}@t.local`,
      role: 'participant',
      locale: 'ja',
    },
  });
  await prisma.workshop.create({
    data: {
      id: ids.workshop,
      slug: `wh-${randomUUID().slice(0, 8)}`,
      title: { en: 'Webhook WS', ja: 'ウェブフックWS' },
      summary: { en: 's', ja: 's' },
      level: 'intro',
      status: 'published',
    },
  });
  await prisma.cohort.create({
    data: {
      id: ids.cohort,
      workshopId: ids.workshop,
      status: 'open',
      startsAt: new Date(Date.now() + 7 * 864e5),
      endsAt: new Date(Date.now() + 8 * 864e5),
      capacity: 20,
      priceJpy: 45_000,
    },
  });
  await prisma.order.create({
    data: {
      id: ids.order,
      buyerUserId: ids.buyer,
      kind: 'individual_enrollment',
      status: 'pending',
      currency: 'JPY',
      subtotal: 45_000,
      discount: 0,
      tax: 4_500,
      total: 49_500,
    },
  });
  await prisma.orderItem.create({
    data: { orderId: ids.order, cohortId: ids.cohort, qty: 1, unitPrice: 45_000 },
  });
  await prisma.payment.create({
    data: {
      id: ids.payment,
      orderId: ids.order,
      provider: 'airwallex_card',
      providerRef,
      status: 'pending',
      amount: 49_500,
    },
  });
});

afterAll(async () => {
  await prisma.enrollment.deleteMany({ where: { cohortId: ids.cohort } });
  await prisma.payment.deleteMany({ where: { orderId: ids.order } });
  await prisma.orderItem.deleteMany({ where: { orderId: ids.order } });
  await prisma.order.deleteMany({ where: { id: ids.order } });
  await prisma.cohort.deleteMany({ where: { id: ids.cohort } });
  await prisma.workshop.deleteMany({ where: { id: ids.workshop } });
  await prisma.user.deleteMany({ where: { id: ids.buyer } });
});

function webhookRequest(): NextRequest {
  const { rawBody, headers } = buildSignedWebhook({
    name: 'payment_intent.succeeded',
    providerRef,
    orderId: ids.order,
    amountMinor: 49_500,
    currency: 'JPY',
    secret: TEST_SECRET,
  });
  return new NextRequest('http://localhost/api/webhooks/airwallex', {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

describe('Airwallex webhook idempotency', () => {
  it('rejects an unsigned / wrong-signature payload with 401', async () => {
    const { rawBody } = buildSignedWebhook({
      name: 'payment_intent.succeeded',
      providerRef,
      orderId: ids.order,
      secret: 'the-wrong-secret',
    });
    const req = new NextRequest('http://localhost/api/webhooks/airwallex', {
      method: 'POST',
      headers: { 'x-timestamp': String(Date.now()), 'x-signature': 'deadbeef' },
      body: rawBody,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('fulfills once and is replay-safe when posted twice', async () => {
    const first = await POST(webhookRequest());
    expect(first.status).toBe(200);
    const second = await POST(webhookRequest());
    expect(second.status).toBe(200);

    const payments = await prisma.payment.findMany({ where: { orderId: ids.order } });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe('succeeded');

    const order = await prisma.order.findUnique({ where: { id: ids.order } });
    expect(order?.status).toBe('paid');

    const enrollments = await prisma.enrollment.findMany({
      where: { userId: ids.buyer, cohortId: ids.cohort },
    });
    expect(enrollments).toHaveLength(1); // no double-fulfillment
    expect(enrollments[0]?.source).toBe('self_paid');
  });
});

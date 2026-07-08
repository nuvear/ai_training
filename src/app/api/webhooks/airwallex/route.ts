import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/server/db/client';
import { getPaymentProvider } from '@/server/payments';
import type { NormalizedEvent } from '@/server/payments/provider';
import { fulfillOrder, sendReceipt, applyRefundToOrder } from '@/server/domain/fulfillment';

// ─────────────────────────────────────────────────────────────────────────────
// Airwallex webhook. Called by Airwallex, NOT the UI → no auth guard. Instead:
//   1. read the RAW body (signature covers the exact bytes),
//   2. verify HMAC signature + timestamp freshness BEFORE parsing (401 on fail),
//   3. process idempotently keyed on payment.provider_ref (the unique column) so
//      a replayed webhook fulfills exactly once (PRODUCT_SPEC §9 / DATA_MODEL §8).
// Always returns 200 quickly on a valid event; DB work runs in a transaction.
// ─────────────────────────────────────────────────────────────────────────────

// Read headers case-insensitively into a plain object for the verifier.
function headerMap(req: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text(); // RAW bytes — do not JSON-parse first
  const provider = getPaymentProvider();
  const { valid, event } = provider.verifyWebhook(rawBody, headerMap(req));

  if (!valid || !event) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  try {
    switch (event.type) {
      case 'payment.succeeded': {
        const orderId = await handlePaymentSucceeded(event);
        if (orderId) await sendReceipt(orderId); // side effect, post-commit
        break;
      }
      case 'payment.failed':
        await handlePaymentFailed(event);
        break;
      case 'refund.succeeded':
        await handleRefundSucceeded(event);
        break;
      default:
        break; // ack unknown events so Airwallex stops retrying
    }
  } catch (err) {
    console.error('[webhook:airwallex] processing error', err);
    // 500 → Airwallex retries; our handlers are idempotent so a retry is safe.
    return NextResponse.json({ error: 'processing error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/** Idempotent on payment.provider_ref. Returns the fulfilled orderId (for the
 * receipt) or null if this was a replay / unknown payment. */
async function handlePaymentSucceeded(event: NormalizedEvent): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { providerRef: event.providerRef },
    });
    if (!payment) return null; // unknown intent — ignore

    // Replay guard: already succeeded → no-op, do not re-fulfill or re-email.
    if (payment.status === 'succeeded') return null;

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'succeeded', receivedAt: new Date() },
    });
    await tx.order.update({ where: { id: payment.orderId }, data: { status: 'paid' } });
    await fulfillOrder(tx, payment.orderId);
    return payment.orderId;
  });
}

async function handlePaymentFailed(event: NormalizedEvent): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { providerRef: event.providerRef },
    });
    if (!payment || payment.status === 'succeeded') return; // don't downgrade a paid order
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
    // Order stays `pending` — buyer may retry with another method.
  });
}

async function handleRefundSucceeded(event: NormalizedEvent): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findUnique({ where: { providerRef: event.providerRef } });
    if (!refund) return; // refund not initiated by us / unknown

    const payment = await tx.payment.findUnique({ where: { id: refund.paymentId } });
    if (!payment) return;

    // Mark the underlying payment refunded when fully refunded.
    const totalRefunded = await tx.refund.aggregate({
      where: { paymentId: payment.id },
      _sum: { amount: true },
    });
    if ((totalRefunded._sum.amount ?? 0) >= payment.amount) {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'refunded' } });
    }
    await applyRefundToOrder(tx, payment.orderId);
  });
}

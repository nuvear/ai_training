import 'server-only';
import type { OrderStatus } from '@/generated/prisma';
import { prisma } from '@/server/db/client';

// Read-only lookup for the post-payment confirmation page. Returns just the
// status + primary payment provider so the UI can tailor its message (e.g.
// konbini "pay at the store" copy). No org context: the confirmation only
// reflects back the buyer's own just-created order id from the redirect.

export interface OrderConfirmation {
  status: OrderStatus;
  /** true when the pending payment was opened as a konbini (voucher) flow. */
  isKonbini: boolean;
}

export async function loadOrderConfirmation(orderId: string): Promise<OrderConfirmation | null> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, payments: { select: { provider: true } } },
  });
  if (!order) return null;
  return {
    status: order.status,
    isKonbini: order.payments.some((p) => p.provider === 'airwallex_konbini'),
  };
}

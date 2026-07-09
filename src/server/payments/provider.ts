import type { Currency } from '@/generated/prisma';

// ─────────────────────────────────────────────────────────────────────────────
// Payment-provider abstraction. ALL provider-specific HTTP lives behind this
// interface (Airwallex in airwallex.ts, a deterministic stub in mock.ts). The
// rest of the app — checkout, webhook route, refund tool — depends only on this
// contract, so the processor can be swapped without touching commerce logic.
// (PRODUCT_SPEC §9, invariant 4: no card data on our servers.)
// ─────────────────────────────────────────────────────────────────────────────

/** Payment methods we may enable on a hosted checkout. */
export type CheckoutMethod = 'card' | 'konbini';

export interface CreateHostedCheckoutArgs {
  orderId: string;
  /** Integer MINOR units (JPY yen; USD cents), as stored in our DB. */
  amountMinor: number;
  currency: Currency;
  methods: CheckoutMethod[];
  successUrl: string;
  failUrl: string;
  customerEmail: string;
}

export interface HostedCheckout {
  /** The provider's payment-intent reference; stored on Payment.provider_ref. */
  providerRef: string;
  /** Where to redirect the buyer to complete payment (provider-hosted). */
  checkoutUrl: string;
}

export interface CreateRefundArgs {
  /** The original payment's provider reference (payment_intent id). */
  providerRef: string;
  amountMinor: number;
  currency: Currency;
  reason: string;
}

export interface RefundResult {
  /** The refund's own provider reference; stored on Refund.provider_ref. */
  providerRef: string;
  status: 'succeeded' | 'pending' | 'failed';
}

/** A provider webhook normalized into our vocabulary. `raw` is retained for the
 * audit trail; all field extraction happens inside the provider. */
export interface NormalizedEvent {
  type: 'payment.succeeded' | 'payment.failed' | 'refund.succeeded' | 'other';
  /** The payment_intent (payment) or refund reference the event concerns. */
  providerRef: string;
  /** merchant_order_id, when the provider echoes it. */
  orderId?: string;
  amountMinor?: number;
  raw: unknown;
}

export interface WebhookVerification {
  valid: boolean;
  event?: NormalizedEvent;
}

export interface PaymentProvider {
  readonly name: 'airwallex' | 'mock';
  createHostedCheckout(args: CreateHostedCheckoutArgs): Promise<HostedCheckout>;
  createRefund(args: CreateRefundArgs): Promise<RefundResult>;
  /** Verify signature FIRST, then parse. Never trust the body before this. */
  verifyWebhook(rawBody: string, headers: Record<string, string>): WebhookVerification;
}

// ── Money conversion (minor ⇄ Airwallex "major" amount) ──────────────────────
// Airwallex `amount` is in MAJOR currency units. Our DB stores minor units:
// JPY has no minor units (yen == major), USD is cents (major = cents / 100).

/** How many minor units make one major unit for a currency. */
export function minorPerMajor(currency: Currency): number {
  return currency === 'JPY' ? 1 : 100;
}

/** DB minor units → provider major-unit amount (number, e.g. 45000 or 310.5). */
export function minorToMajor(amountMinor: number, currency: Currency): number {
  const per = minorPerMajor(currency);
  // Keep at most 2 decimals for USD; JPY is integer. Avoid FP drift.
  return per === 1 ? amountMinor : Math.round(amountMinor) / per;
}

/** Provider major-unit amount → DB minor units. */
export function majorToMinor(amountMajor: number, currency: Currency): number {
  return Math.round(amountMajor * minorPerMajor(currency));
}

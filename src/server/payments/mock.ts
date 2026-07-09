import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Currency } from '@/generated/prisma';
import {
  majorToMinor,
  minorToMajor,
  type CreateHostedCheckoutArgs,
  type CreateRefundArgs,
  type HostedCheckout,
  type NormalizedEvent,
  type PaymentProvider,
  type RefundResult,
  type WebhookVerification,
} from './provider';

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic mock payment provider — used whenever AIRWALLEX_API_KEY is empty
// (dev / CI / e2e), mirroring the magic-link console stub. It performs no HTTP.
// `createHostedCheckout` returns a fake in-app checkout URL and a synthetic
// providerRef; webhook verification uses the SAME HMAC-SHA256 scheme as the real
// Airwallex provider so `buildSignedWebhook()` produces payloads the production
// verifier would also accept, making the idempotency tests faithful.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_SKEW_MS = 5 * 60 * 1000;

function webhookSecret(): string {
  return process.env.AIRWALLEX_WEBHOOK_SECRET ?? '';
}

/** HMAC-SHA256(secret, timestamp + rawBody) as hex — the Airwallex scheme. */
export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret)
    .update(timestamp + rawBody)
    .digest('hex');
}

export interface MockWebhookInput {
  name: string; // e.g. 'payment_intent.succeeded'
  providerRef: string; // payment_intent id or refund id
  orderId?: string; // merchant_order_id
  amountMinor?: number;
  currency?: Currency;
  timestamp?: string; // override for skew tests
  secret?: string; // override the signing secret for negative tests
}

/** Builds a raw body + valid headers for a signed webhook, for use in tests and
 * the mock checkout page. Mirrors Airwallex's `{ name, data: { object } }`. */
export function buildSignedWebhook(input: MockWebhookInput): {
  rawBody: string;
  headers: Record<string, string>;
} {
  const currency = input.currency ?? 'JPY';
  const object: Record<string, unknown> = {
    id: input.providerRef,
    merchant_order_id: input.orderId,
    status: input.name.endsWith('succeeded') ? 'SUCCEEDED' : 'FAILED',
  };
  if (input.amountMinor !== undefined) {
    object.amount = minorToMajor(input.amountMinor, currency);
    object.currency = currency;
  }
  const rawBody = JSON.stringify({ name: input.name, data: { object } });
  const timestamp = input.timestamp ?? String(Date.now());
  const signature = signWebhook(input.secret ?? webhookSecret(), timestamp, rawBody);
  return {
    rawBody,
    headers: { 'x-timestamp': timestamp, 'x-signature': signature },
  };
}

/** Shared webhook verification used by BOTH mock and real providers: verify the
 * signature over `x-timestamp + rawBody`, reject stale timestamps, then map the
 * event name/fields into our NormalizedEvent. Signature is checked BEFORE any
 * JSON parsing of untrusted content. */
export function verifyAirwallexWebhook(
  secret: string,
  rawBody: string,
  headers: Record<string, string>,
): WebhookVerification {
  const timestamp = headers['x-timestamp'];
  const signature = headers['x-signature'];
  if (!secret || !timestamp || !signature) return { valid: false };

  const age = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SKEW_MS) return { valid: false };

  const expected = signWebhook(secret, timestamp, rawBody);
  // constant-time compare; unequal lengths are trivially not equal.
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false };

  let parsed: { name?: string; data?: { object?: Record<string, unknown> } };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { valid: false };
  }

  const name = parsed.name ?? '';
  const object = parsed.data?.object ?? {};
  const currency = (object.currency as Currency | undefined) ?? 'JPY';
  const amountMajor = object.amount as number | undefined;

  const type: NormalizedEvent['type'] =
    name === 'payment_intent.succeeded'
      ? 'payment.succeeded'
      : name === 'payment_intent.failed'
        ? 'payment.failed'
        : name === 'refund.succeeded'
          ? 'refund.succeeded'
          : 'other';

  return {
    valid: true,
    event: {
      type,
      providerRef: String(object.id ?? ''),
      orderId: object.merchant_order_id ? String(object.merchant_order_id) : undefined,
      amountMinor: amountMajor !== undefined ? majorToMinor(amountMajor, currency) : undefined,
      raw: parsed,
    },
  };
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  async createHostedCheckout(args: CreateHostedCheckoutArgs): Promise<HostedCheckout> {
    // Deterministic, order-scoped fake reference so tests can predict it.
    const providerRef = `mock_pi_${args.orderId}`;
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    return {
      providerRef,
      checkoutUrl: `${appUrl}/checkout/mock/${args.orderId}`,
    };
  }

  async createRefund(args: CreateRefundArgs): Promise<RefundResult> {
    return { providerRef: `mock_re_${args.providerRef}`, status: 'succeeded' };
  }

  verifyWebhook(rawBody: string, headers: Record<string, string>): WebhookVerification {
    return verifyAirwallexWebhook(webhookSecret(), rawBody, headers);
  }
}

import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Currency } from '@/generated/prisma';
import {
  minorToMajor,
  majorToMinor,
  type CreateHostedCheckoutArgs,
  type CreateRefundArgs,
  type HostedCheckout,
  type PaymentProvider,
  type RefundResult,
  type WebhookVerification,
} from './provider';
import { verifyAirwallexWebhook } from './mock';

// ─────────────────────────────────────────────────────────────────────────────
// Real Airwallex client. ALL Airwallex HTTP lives in this file. Verified against
// the Airwallex API reference (see docs/DECISIONS.md for the exact doc URLs):
//   • POST /api/v1/authentication/login              → bearer token (~30m TTL)
//   • POST /api/v1/pa/payment_intents/create         → { id, client_secret }
//   • POST /api/v1/pa/refunds/create                 → refund object
//   • Hosted Payment Page on checkout(-demo).airwallex.com with intent + secret
//   • Webhooks: HMAC-SHA256(secret, x-timestamp + rawBody) hex in x-signature
// Amounts on the wire are MAJOR units; we convert from our stored minor units.
// ─────────────────────────────────────────────────────────────────────────────

function isDemo(): boolean {
  return (process.env.AIRWALLEX_ENV ?? 'demo') === 'demo';
}

function apiBase(): string {
  return isDemo() ? 'https://api-demo.airwallex.com' : 'https://api.airwallex.com';
}

function checkoutHost(): string {
  return isDemo() ? 'https://checkout-demo.airwallex.com' : 'https://checkout.airwallex.com';
}

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

export class AirwallexProvider implements PaymentProvider {
  readonly name = 'airwallex' as const;
  private cached: CachedToken | null = null;

  private get clientId(): string {
    return process.env.AIRWALLEX_CLIENT_ID ?? '';
  }
  private get apiKey(): string {
    return process.env.AIRWALLEX_API_KEY ?? '';
  }

  /** Cached bearer token; re-authenticates ~25m in (Airwallex TTL ~30m). */
  private async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.token;
    const res = await fetch(`${apiBase()}/api/v1/authentication/login`, {
      method: 'POST',
      headers: {
        'x-client-id': this.clientId,
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`Airwallex auth failed: ${res.status} ${await safeText(res)}`);
    }
    const body = (await res.json()) as { token: string };
    this.cached = { token: body.token, expiresAt: Date.now() + 25 * 60 * 1000 };
    return body.token;
  }

  private async authedFetch(path: string, payload: unknown): Promise<Response> {
    const token = await this.token();
    return fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  async createHostedCheckout(args: CreateHostedCheckoutArgs): Promise<HostedCheckout> {
    const res = await this.authedFetch('/api/v1/pa/payment_intents/create', {
      request_id: randomUUID(),
      amount: minorToMajor(args.amountMinor, args.currency),
      currency: args.currency,
      merchant_order_id: args.orderId,
      metadata: { orderId: args.orderId, customerEmail: args.customerEmail },
    });
    if (!res.ok) {
      throw new Error(`Airwallex intent create failed: ${res.status} ${await safeText(res)}`);
    }
    const intent = (await res.json()) as { id: string; client_secret: string };

    // Hosted Payment Page: redirect the buyer with the intent id + client_secret.
    // Airwallex renders the enabled methods; we pass success/fail return URLs.
    const params = new URLSearchParams({
      intent_id: intent.id,
      client_secret: intent.client_secret,
      currency: args.currency,
      successUrl: args.successUrl,
      failUrl: args.failUrl,
    });
    for (const method of args.methods) params.append('methods', method);

    return {
      providerRef: intent.id,
      checkoutUrl: `${checkoutHost()}/#/standalone/checkout?${params.toString()}`,
    };
  }

  async createRefund(args: CreateRefundArgs): Promise<RefundResult> {
    const res = await this.authedFetch('/api/v1/pa/refunds/create', {
      request_id: randomUUID(),
      payment_intent_id: args.providerRef,
      amount: minorToMajor(args.amountMinor, args.currency),
      reason: args.reason,
    });
    if (!res.ok) {
      throw new Error(`Airwallex refund failed: ${res.status} ${await safeText(res)}`);
    }
    const refund = (await res.json()) as { id: string; status?: string };
    const status: RefundResult['status'] =
      refund.status === 'SUCCEEDED'
        ? 'succeeded'
        : refund.status === 'FAILED'
          ? 'failed'
          : 'pending';
    return { providerRef: refund.id, status };
  }

  verifyWebhook(rawBody: string, headers: Record<string, string>): WebhookVerification {
    return verifyAirwallexWebhook(process.env.AIRWALLEX_WEBHOOK_SECRET ?? '', rawBody, headers);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}

// Re-exported so callers importing from this module get the conversion helper
// alongside the provider without reaching into provider.ts internals.
export { majorToMinor };
export type { Currency };

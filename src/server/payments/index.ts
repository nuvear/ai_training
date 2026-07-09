import 'server-only';
import type { PaymentProvider } from './provider';
import { AirwallexProvider } from './airwallex';
import { MockPaymentProvider } from './mock';

// Returns the real Airwallex client when AIRWALLEX_API_KEY is configured,
// otherwise the deterministic mock (dev / CI / e2e) — the same "keyed vs stub"
// switch used for Resend mail and the localization engine. One instance per
// process so the Airwallex bearer-token cache is shared.
let provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (provider) return provider;
  provider = process.env.AIRWALLEX_API_KEY ? new AirwallexProvider() : new MockPaymentProvider();
  return provider;
}

/** Test/e2e helper: reset the memoized provider (e.g. after changing env). */
export function resetPaymentProvider(): void {
  provider = null;
}

export type { PaymentProvider } from './provider';

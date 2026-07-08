import { describe, it, expect } from 'vitest';
import { getPaymentProvider, resetPaymentProvider } from '@/server/payments';

// One-off live smoke test against the Airwallex SANDBOX. Not part of `pnpm test`
// (it lives outside the vitest include globs). Run explicitly:
//   pnpm exec vitest run scripts/airwallex-smoke.test.ts
// Requires real AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY in .env (AIRWALLEX_ENV=demo).
const hasKeys = Boolean(process.env.AIRWALLEX_API_KEY && process.env.AIRWALLEX_CLIENT_ID);

describe.runIf(hasKeys)('Airwallex sandbox — outbound smoke', () => {
  it('authenticates and returns a hosted checkout URL for ¥45,000', async () => {
    resetPaymentProvider();
    const provider = getPaymentProvider();
    const res = await provider.createHostedCheckout({
      orderId: `smoke-${Date.now()}`,
      amountMinor: 45000,
      currency: 'JPY',
      methods: ['card', 'konbini'],
      successUrl: 'http://localhost:3000/checkout/complete',
      failUrl: 'http://localhost:3000/checkout/failed',
      customerEmail: 'smoke@workshopos.local',
    });
    // eslint-disable-next-line no-console
    console.log('AIRWALLEX SMOKE →', {
      providerRef: res.providerRef,
      checkoutUrl: res.checkoutUrl,
    });
    expect(res.providerRef).toBeTruthy();
    expect(res.checkoutUrl).toMatch(/^https:\/\//);
  }, 30_000);
});

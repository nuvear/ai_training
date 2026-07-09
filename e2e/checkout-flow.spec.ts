import { test, expect, type Page } from '@playwright/test';

// The seeded bookable cohort (prisma/seed.ts): ¥45,000 on ai-fluency-discernment.
const COHORT_ID = '00000000-0000-0000-0000-00000000c001';

async function signInAsOwner(page: Page) {
  const res = await page.request.post('/api/auth/magic-link', {
    data: { email: 'owner@workshopos.local' },
  });
  const { devLoginUrl } = (await res.json()) as { devLoginUrl: string };
  const token = new URL(devLoginUrl).searchParams.get('token')!;
  await page.goto(`/api/auth/callback?token=${token}`);
}

// M2: the B2C checkout screen prices the order server-side, applies a promo, and
// hands off to the payment provider. Runs against the MOCK provider (Airwallex
// keys are blanked for the e2e server in playwright.config.ts), so no live keys.
test('B2C checkout applies a promo and creates an order + checkout handoff', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto(`/en/checkout/${COHORT_ID}`);

  const form = page.getByTestId('checkout-form');
  await expect(form).toBeVisible();

  const totalBefore = (await page.getByTestId('order-total').innerText()).trim();

  // Apply the early-bird promo → the server re-quotes; the total must drop.
  await page.getByTestId('promo-input').fill('HAYAWARI20');
  await page.getByTestId('apply-promo').click();
  await expect
    .poll(async () => (await page.getByTestId('order-total').innerText()).trim())
    .not.toBe(totalBefore);

  // Pay → POST /api/checkout succeeds and the app redirects to the provider's
  // checkout URL. Check the response status (not the body — the redirect that
  // follows discards the body) and assert navigation away from the checkout page.
  const respPromise = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/checkout$/.test(new URL(r.url()).pathname),
  );
  await page.getByTestId('pay-button').click();
  const resp = await respPromise;
  expect(resp.status()).toBe(200);
  await page.waitForURL((url) => !url.toString().includes(COHORT_ID), { timeout: 15_000 });
});

import { test, expect } from '@playwright/test';

// M0 exit criterion: the toy command is demonstrably blocked without approval,
// executes after approval, and a ledger row is present throughout.
test('copilot ping is blocked until approved, then executes', async ({ page, request }) => {
  // Sign in as the seeded owner through the real magic-link flow.
  const res = await request.post('/api/auth/magic-link', {
    data: { email: 'owner@workshopos.local' },
  });
  expect(res.ok()).toBeTruthy();
  const { devLoginUrl } = (await res.json()) as { devLoginUrl?: string };
  expect(devLoginUrl).toBeTruthy();

  // Follow the token on THIS server (baseURL), regardless of APP_URL's host.
  const token = new URL(devLoginUrl!).searchParams.get('token')!;
  await page.goto(`/api/auth/callback?token=${token}`);
  await expect(page).toHaveURL(/\/copilot/); // owner lands on the copilot console

  // Send the only recognized M0 command.
  await page.getByTestId('copilot-input').fill('ping the workshop system');
  await page.getByTestId('copilot-send').click();

  // A plan step appears: approve-tier, and NOT executed yet.
  const step = page.getByTestId('plan-step');
  await expect(step).toBeVisible();
  await expect(step.locator('.badge.approve')).toBeVisible();
  await expect(page.getByTestId('approve-step')).toBeVisible();
  await expect(page.getByTestId('step-executed')).toHaveCount(0);

  // Approve → the tool executes and the bilingual pong is shown.
  await page.getByTestId('approve-step').click();
  await expect(page.getByTestId('step-executed')).toBeVisible();
  await expect(page.getByTestId('step-executed')).toContainText('Pong');
});

// RBAC: an anonymous visitor cannot reach the copilot surface.
test('anonymous visitor is redirected away from the copilot', async ({ page }) => {
  await page.goto('/en/copilot');
  await expect(page).toHaveURL(/\/signin/);
});

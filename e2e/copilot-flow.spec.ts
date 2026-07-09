import { test, expect, type Page } from '@playwright/test';

const LAUNCH_EN =
  'Launch a 3-session Design Thinking cohort in September, ¥45,000, cap 30, early-bird 20% off until Aug 15.';

async function signInAsOwner(page: Page) {
  const res = await page.request.post('/api/auth/magic-link', {
    data: { email: 'owner@workshopos.local' },
  });
  const { devLoginUrl } = (await res.json()) as { devLoginUrl: string };
  const token = new URL(devLoginUrl).searchParams.get('token')!;
  await page.goto(`/api/auth/callback?token=${token}`);
}

interface PlanStep {
  actionId: string;
  seq: number;
  toolName: string;
  tier: string;
}

// M5 exit criteria 1 & 2: the launch command produces the 5-step plan; auto steps
// execute, approve steps queue, and the plan completes after approval — with the
// ledger holding the parent plan + children at the correct tiers.
test('launch command → 5-step plan → auto runs, approve queues, completes on approval', async ({
  page,
}) => {
  await signInAsOwner(page);

  const planRes = await page.request.post('/api/copilot/plan', {
    data: { command: LAUNCH_EN, locale: 'en' },
  });
  const plan = (await planRes.json()) as {
    parentId: string;
    recognized: boolean;
    steps: PlanStep[];
  };
  expect(plan.recognized).toBe(true);
  expect(plan.steps.map((s) => s.toolName)).toEqual([
    'cohort.create',
    'landing.generate_variants',
    'promo.create',
    'campaign.draft_sequence',
    'campaign.approve_and_schedule',
  ]);
  expect(plan.steps.map((s) => s.tier)).toEqual(['approve', 'auto', 'approve', 'auto', 'approve']);

  // Run: the auto step with no dependency (landing, seq 2) executes immediately.
  const run = (await (
    await page.request.post(`/api/copilot/plan/${plan.parentId}/run`)
  ).json()) as { executed: string[] };
  expect(run.executed).toContain(plan.steps[1].actionId);

  // Approve the cohort (step 1) → unblocks + auto-runs the campaign draft (step 4).
  const s1 = await (
    await page.request.post(`/api/approvals/${plan.steps[0].actionId}/approve`)
  ).json();
  expect(s1.status).toBe('executed');
  // Approve the promo (step 3).
  await page.request.post(`/api/approvals/${plan.steps[2].actionId}/approve`);
  // Approve the campaign schedule (step 5): its campaignId $ref resolves only if the
  // auto campaign-draft (step 4) already ran — so 'executed' proves the whole chain.
  const s5 = await (
    await page.request.post(`/api/approvals/${plan.steps[4].actionId}/approve`)
  ).json();
  expect(s5.status).toBe('executed');
});

// UI smoke: the console renders the plan preview with tier badges and runs it.
test('copilot console renders the plan preview and runs it', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/en/copilot');
  await page.getByTestId('copilot-input').fill(LAUNCH_EN);
  await page.getByTestId('copilot-send').click();

  await expect(page.getByTestId('plan-preview')).toBeVisible();
  await expect(page.getByTestId('plan-step')).toHaveCount(5);
  await expect(page.getByTestId('plan-preview').locator('.badge.approve').first()).toBeVisible();

  await page.getByTestId('approve-plan-run').click();
  await expect(page.getByTestId('awaiting-note')).toBeVisible(); // approve steps queued
});

// RBAC: an anonymous visitor cannot reach the copilot surface.
test('anonymous visitor is redirected away from the copilot', async ({ page }) => {
  await page.goto('/en/copilot');
  await expect(page).toHaveURL(/\/signin/);
});

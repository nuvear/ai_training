import { test, expect, type Page } from '@playwright/test';

// Signs in as the seeded owner via the real magic-link flow; the session cookie
// lands on the browser context, which page.request shares.
async function signInAsOwner(page: Page) {
  const res = await page.request.post('/api/auth/magic-link', {
    data: { email: 'owner@workshopos.local' },
  });
  const { devLoginUrl } = (await res.json()) as { devLoginUrl: string };
  const token = new URL(devLoginUrl).searchParams.get('token')!;
  await page.goto(`/api/auth/callback?token=${token}`);
}

// M1 exit criterion: create workshop (EN) → localize → mark reviewed → publish →
// appears in the public catalog in both locales.
test('author EN → localize → review → publish → catalog shows it in both locales', async ({
  page,
}) => {
  await signInAsOwner(page);

  const stamp = Date.now();
  const titleEn = `E2E Catalog Workshop ${stamp}`;
  const summaryEn = `E2E summary marker ${stamp}`;
  // Exact slug workshop.create derives from the title (slugify). Match it exactly,
  // not by prefix — earlier e2e runs leave their own published rows behind.
  const slug = `e2e-catalog-workshop-${stamp}`;

  // 1. create — auto tier, executes immediately
  const create = await page.request.post('/api/tools/execute', {
    data: {
      toolName: 'workshop.create',
      input: { title: { en: titleEn }, summary: { en: summaryEn }, level: 'intro' },
    },
  });
  expect(create.ok()).toBeTruthy();
  const { output, status } = (await create.json()) as {
    status: string;
    output: { workshopId: string };
  };
  expect(status).toBe('executed');
  const workshopId = output.workshopId;

  // 2. localize to JA — auto tier
  const localize = await page.request.post('/api/tools/execute', {
    data: {
      toolName: 'content.localize',
      input: {
        entityType: 'workshop',
        entityId: workshopId,
        targetLocale: 'ja',
        register: 'polite',
      },
    },
  });
  expect((await localize.json()).status).toBe('executed');

  // 3. mark JA reviewed — approve tier → proposed, then approve it
  const markReviewed = await page.request.post('/api/tools/execute', {
    data: {
      toolName: 'content.mark_reviewed',
      input: { entityType: 'workshop', entityId: workshopId, locale: 'ja' },
    },
  });
  const mrBody = (await markReviewed.json()) as { actionId: string; requiresApproval: boolean };
  expect(mrBody.requiresApproval).toBe(true);
  await page.request.post(`/api/approvals/${mrBody.actionId}/approve`);

  // 4. publish — approve tier → proposed, then approve → executed
  const publish = await page.request.post('/api/tools/execute', {
    data: { toolName: 'workshop.publish', input: { workshopId } },
  });
  const pubBody = (await publish.json()) as { actionId: string; requiresApproval: boolean };
  expect(pubBody.requiresApproval).toBe(true);
  const approved = await page.request.post(`/api/approvals/${pubBody.actionId}/approve`);
  expect((await approved.json()).status).toBe('executed');

  // 5a. EN catalog shows the workshop
  await page.goto('/en/catalog');
  const enCard = page.locator(`[data-testid="catalog-card"][data-slug="${slug}"]`);
  await expect(enCard).toHaveCount(1);
  await expect(enCard).toContainText(summaryEn);
  await expect(enCard).toContainText('Led by Rajkumar Rajagobalan');

  // 5b. JA catalog shows the same workshop with JA typography/labels
  await page.goto('/ja/catalog');
  const jaCard = page.locator(`[data-testid="catalog-card"][data-slug="${slug}"]`);
  await expect(jaCard).toHaveCount(1);
  await expect(jaCard).toContainText('入門'); // JA level label
  await expect(jaCard).toContainText('ラジクマール'); // founder katakana byline
});

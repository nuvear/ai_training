import { test, expect } from '@playwright/test';

// M0 exit criterion: locale toggle switches a sample page with correct JA
// typography tokens, without losing page state.
test('locale switcher swaps typography tokens and preserves the page', async ({ page }) => {
  await page.goto('/en');

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('active-locale')).toHaveText('en');
  await expect(page.getByTestId('line-height-token')).toHaveText('1.7');
  const enLineHeight = await page.evaluate(() => getComputedStyle(document.body).lineHeight);

  // Switch to Japanese via the switcher pill.
  await page.getByRole('button', { name: '日本語' }).click();

  await expect(page).toHaveURL(/\/ja$/); // still the home page, now in JA
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.getByTestId('active-locale')).toHaveText('ja');
  await expect(page.getByTestId('line-height-token')).toHaveText('1.8');

  const jaLineHeight = await page.evaluate(() => getComputedStyle(document.body).lineHeight);
  expect(jaLineHeight).not.toBe(enLineHeight); // JA gets more air (1.8 vs 1.7)

  // The sample body text is the JA variant, not English.
  await expect(page.getByTestId('sample-body')).toContainText('余白');
});

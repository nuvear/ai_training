import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? 'line' : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Build once, then serve — closest to the CI-like production path. The DB must
  // already be migrated + seeded (the e2e npm script handles that ordering).
  webServer: {
    command: `next build && next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    // Force the mock payment provider in e2e/CI — never hit live Airwallex.
    // Empty values stay empty: Next's .env loader won't override an existing
    // process.env var, so getPaymentProvider() sees no key → mock.
    // APP_URL must match the e2e port so redirect/checkout URLs resolve here.
    env: {
      ...process.env,
      APP_URL: BASE_URL,
      AIRWALLEX_API_KEY: '',
      AIRWALLEX_CLIENT_ID: '',
    },
  },
});

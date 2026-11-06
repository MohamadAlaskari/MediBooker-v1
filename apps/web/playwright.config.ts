import { defineConfig, devices } from '@playwright/test';

const isCi = process.env.CI !== undefined && process.env.CI !== '';

/**
 * End-to-end tests against the production build (03 §14), one project per reading direction, each
 * with the language and time zone of a real user. Run `pnpm build` first.
 */
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  failOnFlakyTests: isCi,
  updateSnapshots: isCi ? 'none' : 'missing',
  reporter: [
    ['html', { open: 'never' }],
    ['junit', { outputFile: 'reports/e2e-junit.xml' }],
  ],
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'ar-rtl',
      use: { ...devices['Desktop Chrome'], locale: 'ar-SA', timezoneId: 'Asia/Riyadh' },
    },
    {
      name: 'en-ltr',
      use: { ...devices['Desktop Chrome'], locale: 'en-GB', timezoneId: 'Europe/Berlin' },
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:3000/healthz',
    reuseExistingServer: !isCi,
    env: {
      API_INTERNAL_URL: 'http://127.0.0.1:3001',
      PUBLIC_SITE_URL: 'http://localhost:3000',
      APP_ENV: 'ci',
    },
  },
});

import { defineConfig, devices } from '@playwright/test';
import { API_STUB_PORT, WEB_PORT } from './e2e/support/ports.ts';

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
  use: { baseURL: `http://localhost:${String(WEB_PORT)}`, trace: 'retain-on-failure' },
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
  // A stub stands in for the API, so every case exists on demand; the CI job images proves the
  // whole way to a practice's database.
  webServer: [
    {
      command: 'node e2e/support/api-stub.ts',
      url: `http://127.0.0.1:${String(API_STUB_PORT)}/health`,
      reuseExistingServer: !isCi,
      env: { API_STUB_PORT: String(API_STUB_PORT) },
    },
    {
      command: `pnpm exec next start --port ${String(WEB_PORT)}`,
      url: `http://localhost:${String(WEB_PORT)}/healthz`,
      reuseExistingServer: !isCi,
      env: {
        API_INTERNAL_URL: `http://127.0.0.1:${String(API_STUB_PORT)}`,
        PUBLIC_SITE_URL: `http://localhost:${String(WEB_PORT)}`,
        APP_ENV: 'ci',
      },
    },
  ],
});

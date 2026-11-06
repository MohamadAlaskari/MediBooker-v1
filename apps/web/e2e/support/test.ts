import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';
import { API_STUB_PORT } from './ports';

/**
 * Every test also fails on a Content-Security-Policy violation and, after it ran, on a serious or
 * critical accessibility violation of the page it left open (03 §14).
 */
export const test = base.extend<{ pageChecks: undefined }>({
  pageChecks: [
    async ({ page, javaScriptEnabled }, use) => {
      // What the proxy does in production: the browser asks its own origin, and the API answers.
      await page.route('**/api/v1/**', async (route) => {
        const request = route.request();
        const { pathname, search } = new URL(request.url());
        const url = `http://127.0.0.1:${String(API_STUB_PORT)}${pathname}${search}`;
        // The browser adds its cookies later than a route sees the request.
        const cookies = await page.context().cookies(request.url());
        const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
        const headers = { ...request.headers(), cookie };
        await route.fulfill({ response: await route.fetch({ url, headers }) });
      });
      const violations: string[] = [];
      page.on('console', (message) => {
        if (message.text().includes('Content Security Policy')) violations.push(message.text());
      });
      await use(undefined);
      expect(violations).toEqual([]);
      // Axe runs in the page, so it needs JavaScript.
      if (page.url() === 'about:blank' || !javaScriptEnabled) return;
      const { violations: axe } = await new AxeBuilder({ page }).analyze();
      const blocking = axe.filter(({ impact }) => impact === 'serious' || impact === 'critical');
      expect(blocking.map(({ id }) => id)).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';

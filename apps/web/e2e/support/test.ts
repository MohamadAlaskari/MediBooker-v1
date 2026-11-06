import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';

/**
 * Every test also fails on a Content-Security-Policy violation and, after it ran, on a serious or
 * critical accessibility violation of the page it left open (03 §14).
 */
export const test = base.extend<{ pageChecks: undefined }>({
  pageChecks: [
    async ({ page, javaScriptEnabled }, use) => {
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

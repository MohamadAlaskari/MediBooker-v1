import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Page } from '@playwright/test';
import { differencesFromContract } from './contract';
import { API_STUB_PORT } from './ports';

/** The widths of 06 §1: a desktop and a phone. */
const WIDTHS = [1440, 390];
const HEIGHT = 844;

/** What is moving now, also a colour between two states, is not what a page is judged by. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    ),
  );
}

/**
 * Fails on a serious or critical violation of the page as it stands now, and notes what is less than
 * that on the test (annotations of the report). React Aria's announcer stays out: what it announced
 * stays in it for seven seconds, labelled by a button that may have gone by then, and it is no part of
 * what anyone reads on a page.
 */
export async function expectAccessible(page: Page, state = 'the end of the test'): Promise<void> {
  await settled(page);
  const { violations } = await new AxeBuilder({ page }).exclude('[data-live-announcer]').analyze();
  const blocking = violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
  const described = blocking.map(
    ({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(' ')).join(', ')}`,
  );
  expect(described, state).toEqual([]);
  for (const { id, impact, nodes } of violations) {
    if (!blocking.some((one) => one.id === id)) {
      base.info().annotations.push({
        type: `axe ${impact ?? 'unknown'}`,
        description: `${state}: ${id}: ${nodes.map(({ target }) => target.join(' ')).join(', ')}`,
      });
    }
  }
}

/** The same at both widths of 06 §1, and back to the width the test had. */
export async function expectAccessibleAtBothWidths(page: Page, state: string): Promise<void> {
  const before = page.viewportSize();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT });
    await expectAccessible(page, `${state} at ${String(width)} px`);
  }
  if (before !== null) await page.setViewportSize(before);
}

/**
 * Every test also fails on a Content-Security-Policy violation, on a request or an answer of the stub
 * that the contract does not know, and, after it ran, on a serious or critical accessibility violation
 * of the page it left open (03 §14).
 */
export const test = base.extend<{ pageChecks: undefined }>({
  pageChecks: [
    async ({ page, context, javaScriptEnabled }, use) => {
      const differences: string[] = [];
      // What the proxy does in production: the browser asks its own origin, and the API answers.
      // For the whole context, because some tests open a second tab.
      await context.route('**/api/v1/**', async (route) => {
        const request = route.request();
        const { pathname, search } = new URL(request.url());
        const url = `http://127.0.0.1:${String(API_STUB_PORT)}${pathname}${search}`;
        // The browser adds its cookies later than a route sees the request.
        const cookies = await context.cookies(request.url());
        const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
        const headers = { ...request.headers(), cookie };
        const answer = await route.fetch({ url, headers }).catch(() => undefined);
        // The stub destroyed the socket: an answer that got lost on its way.
        if (answer === undefined) {
          await route.abort('connectionreset');
          return;
        }
        differences.push(...differencesFromContract(request, answer.status(), await answer.text()));
        await route.fulfill({ response: answer });
      });
      const violations: string[] = [];
      page.on('console', (message) => {
        if (message.text().includes('Content Security Policy')) violations.push(message.text());
      });
      await use(undefined);
      expect(violations).toEqual([]);
      expect(differences).toEqual([]);
      // Axe runs in the page, so it needs JavaScript.
      if (page.url() === 'about:blank' || !javaScriptEnabled) return;
      await expectAccessible(page);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';

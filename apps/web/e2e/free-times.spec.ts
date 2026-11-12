import type { Page, TestInfo } from '@playwright/test';
import { newAddress, signedIn, type Locale } from './support/journey';
import { expect, test } from './support/test';

const SERVICE = '10000000-0000-4000-8000-000000000001';

const TEXTS = {
  en: { days: 'Days', forward: 'ArrowRight', morning: 'Morning', details: 'Your details for' },
  ar: { days: 'الأيام', forward: 'ArrowLeft', morning: 'صباحًا', details: 'بياناتك لدى' },
} as const;

/** Signed in, on a practice's booking page: its free times are for signed-in people only (B07). */
async function atTheTimes(
  page: Page,
  testInfo: TestInfo,
  { locale = 'en', slug = 'al-noor' }: { readonly locale?: Locale; readonly slug?: string } = {},
): Promise<void> {
  await signedIn(page, locale, newAddress(testInfo));
  await page.goto(`/${locale}/book/${slug}`);
}

test.describe('the free times on the booking page (08 P06, B07)', () => {
  test('shows the first free day with its times, in the zone of the practice', async ({
    page,
  }, testInfo) => {
    await atTheTimes(page, testInfo);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Sunday, November 8' })).toBeVisible();
    const morning = main.getByRole('group', { name: 'Morning' });
    await expect(morning.getByRole('link')).toHaveText(['09:00', '09:30']);
    await expect(main.getByRole('group', { name: 'Afternoon' }).getByRole('link')).toHaveText([
      '16:00',
    ]);
  });

  test('keeps closed days and the weekend from being chosen', async ({ page }, testInfo) => {
    await atTheTimes(page, testInfo);
    const days = page.getByRole('radiogroup', { name: 'Days' });
    await expect(days.getByRole('radio', { name: 'Friday, November 13' })).toBeDisabled();
    await expect(days.getByRole('radio', { name: 'Monday, November 9' })).toBeEnabled();
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(days.getByRole('radio', { name: 'Thursday, November 19' })).toBeDisabled();
    await expect(days.getByRole('radio', { name: 'Sunday, November 15' })).toBeEnabled();
  });

  for (const locale of ['en', 'ar'] as const) {
    test(`works by keyboard in reading direction, and keeps the choice out of the address (${locale})`, async ({
      page,
    }, testInfo) => {
      const { days, forward, morning, details } = TEXTS[locale];
      await atTheTimes(page, testInfo, { locale });
      const strip = page.getByRole('radiogroup', { name: days });
      const selected = strip.locator('[aria-checked="true"]');
      await expect(selected).toHaveCount(1);
      const firstDay = await selected.getAttribute('aria-label');
      await selected.focus();
      await page.keyboard.press(forward);
      await expect(selected).not.toHaveAttribute('aria-label', firstDay ?? '');
      await expect(selected).toBeFocused();

      const times = page.getByRole('group', { name: morning }).getByRole('link');
      await expect(times).toHaveCount(2);
      await times.first().focus();
      await page.keyboard.press(forward);
      await expect(times.nth(1)).toBeFocused();
      await page.keyboard.press('Enter');

      // The next step on the same page: the details of a first booking, with nothing in the address.
      await expect(
        page.getByRole('heading', { level: 1, name: new RegExp(details) }),
      ).toBeVisible();
      const url = new URL(page.url());
      expect(url.pathname).toBe(`/${locale}/book/al-noor`);
      expect(url.search).toBe('');
      expect(url.hash).toBe('');
      expect(page.url()).not.toContain(SERVICE);
    });
  }

  test('asks for a chosen doctor, and another service', async ({ page }, testInfo) => {
    await atTheTimes(page, testInfo);
    const times = page.getByRole('main').getByRole('link', { name: /Sunday, November 8/ });
    await expect(times).toHaveCount(3);

    const request = page.waitForRequest((sent) => sent.url().includes('providerId='));
    await page.getByRole('radio', { name: 'Dr. Lina Mansour' }).click();
    await request;
    await expect(times).toHaveCount(1);

    const service = page.waitForRequest((sent) =>
      sent.url().includes('serviceId=10000000-0000-4000-8000-000000000002'),
    );
    await page.getByRole('button', { name: /Check-up/ }).click();
    await page.getByRole('option', { name: /Vaccination/ }).click();
    await service;
    await expect(page.getByRole('button', { name: /Vaccination/ })).toBeVisible();
  });

  test('gives every choice a target of at least 44 px', async ({ page }, testInfo) => {
    await atTheTimes(page, testInfo);
    const main = page.getByRole('main');
    await expect(main.getByRole('group', { name: 'Morning' })).toBeVisible();
    for (const target of [
      main.getByRole('button', { name: /Check-up/ }),
      main.getByRole('radio', { name: 'Any doctor' }),
      main.getByRole('radio', { name: 'Monday, November 9' }),
      main.getByRole('button', { name: 'Next week' }),
      main.getByRole('group', { name: 'Morning' }).getByRole('link').first(),
    ]) {
      const box = await target.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
  });

  test('keeps the type of the design next to a colour', async ({ page }, testInfo) => {
    await atTheTimes(page, testInfo);
    const time = page.getByRole('main').getByRole('group', { name: 'Morning' });
    await expect(time.getByRole('link').first()).toHaveCSS('font-weight', '600');
  });

  test('writes the digits of the practice', async ({ page }, testInfo) => {
    await atTheTimes(page, testInfo, { slug: 'closed' });
    await expect(
      page.getByRole('main').getByRole('group', { name: 'Morning' }).getByRole('link').first(),
    ).toHaveText('٠٩:٠٠');
  });

  test('says so when nothing is free, and shows the phone', async ({ page }, testInfo) => {
    await atTheTimes(page, testInfo, { slug: 'no-times' });
    const main = page.getByRole('main');
    await expect(main.getByText('No free times in the next six weeks')).toBeVisible();
    await expect(main.getByRole('link', { name: '+966 11 000 0000' })).toBeVisible();
  });

  test('says so when the times cannot be loaded, and tries again', async ({ page }, testInfo) => {
    let failing = true;
    await page.route('**/availability*', async (route) => {
      if (failing)
        await route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: '{"code":"SERVICE_UNAVAILABLE"}',
        });
      else await route.fallback();
    });
    await atTheTimes(page, testInfo);
    const main = page.getByRole('main');
    await expect(main.getByText('The free times could not be loaded.')).toBeVisible({
      timeout: 20_000,
    });
    failing = false;
    await main.getByRole('button', { name: 'Try again' }).click();
    await expect(main.getByRole('group', { name: 'Morning' })).toBeVisible();
  });

  test.describe('on an open page', () => {
    test.use({ reducedMotion: 'reduce' });

    test('a time someone else took disappears at the next poll', async ({ page }, testInfo) => {
      await signedIn(page, 'en', newAddress(testInfo));
      await page.clock.install();
      await page.goto('/en/book/al-noor');
      const morning = page.getByRole('main').getByRole('group', { name: 'Morning' });
      await expect(morning.getByRole('link')).toHaveCount(2);

      await page.route('**/free-times*', async (route) => {
        const date = new URL(route.request().url()).searchParams.get('date') ?? '';
        await route.fulfill({
          json: { date, times: [{ startsAt: `${date}T06:30:00Z` }] },
        });
      });
      await page.clock.fastForward('00:46');
      await expect(morning.getByRole('link')).toHaveCount(1);
      await expect(morning.getByRole('link')).toHaveText('09:30');
    });
  });
});

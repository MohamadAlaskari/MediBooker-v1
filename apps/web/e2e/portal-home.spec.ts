import { messages } from '@medibooker/i18n';
import type { Locator, Page, Route } from '@playwright/test';
import {
  chooseTime,
  hook,
  joinPractice,
  localeOf,
  newAddress,
  pressConfirm,
  signedIn,
  startOf,
  type Locale,
} from './support/journey';
import { expect, test } from './support/test';

/** What the stub's public page calls the services: the same in both languages, Latin in Arabic. */
const CHECK_UP = 'Check-up';
/** What an appointment calls its service, per language. */
const SERVICE = { ar: 'فحص', en: 'Check-up' } as const;
const VACCINATION = 'Vaccination';
const PRACTICE_NAME = { ar: 'مركز النور الطبي', en: 'Al Noor Medical Centre' } as const;
const FIRST_STRONG_ISOLATE = String.fromCodePoint(0x2068);
const POP_DIRECTIONAL_ISOLATE = String.fromCodePoint(0x2069);

const AN_APPOINTMENT = '**/api/v1/practices/*/appointments/*';
const MOVE = `${AN_APPOINTMENT}/reschedule`;
const AVAILABILITY = '**/api/v1/public/practices/al-noor/availability?*';
const PAST_PAGE_AFTER_A_CURSOR = '**/api/v1/practices/*/me/appointments?*cursor=*';
const MY_PRACTICES = '**/api/v1/me/practices';
const PUBLIC_PAGE = '**/api/v1/public/practices/al-noor';

function problem(
  status: number,
  code: string,
  retryAfter?: number,
): {
  status: number;
  contentType: string;
  headers: Record<string, string>;
  body: string;
} {
  const headers: Record<string, string> =
    retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) };
  return {
    status,
    contentType: 'application/problem+json',
    headers,
    body: JSON.stringify({ status, code }),
  };
}

/** Refuses the reads of a route until the returned function lets them pass. */
async function refuseReads(page: Page, url: string): Promise<() => Promise<void>> {
  const handler = async (route: Route): Promise<void> => {
    if (route.request().method() === 'GET') await route.fulfill(problem(429, 'RATE_LIMITED'));
    else await route.fallback();
  };
  await page.route(url, handler);
  return () => page.unroute(url, handler);
}

function heading(page: Page): Locator {
  return page.getByRole('heading', { level: 1 });
}

/** Signed in, joined, with a booked appointment: on the home. */
async function homeWithAppointments(page: Page, locale: Locale, email: string, count: number) {
  await signedIn(page, locale, email);
  for (let index = 0; index < count; index += 1) {
    // The first time still free that morning: a booked one is no longer offered.
    await chooseTime(page, locale);
    if (index === 0) await joinPractice(page, locale);
    await pressConfirm(page, locale);
    await expect(
      page.getByRole('heading', { name: messages[locale].portal.book.bookedTitle }),
    ).toBeVisible();
  }
  await page.goto(`/${locale}/home`);
}

test.describe.configure({ mode: 'parallel' });

test.describe('the portal home (08 B06, PW2)', () => {
  test('is where a sign-in lands: says there is nothing yet, and leads to a booking', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await signedIn(page, locale, newAddress(testInfo));
    await expect(page).toHaveURL(`/${locale}/home`);
    await expect(heading(page)).toContainText(portal.home.hello);
    const main = page.getByRole('main');
    await expect(main).toContainText(portal.home.empty);
    const nav = page.getByRole('navigation', { name: portal.nav.label });
    await expect(nav.getByRole('link', { name: portal.nav.home })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: portal.nav.book })).toHaveAttribute(
      'href',
      `/${locale}#free-times`,
    );
    // The practice of the installation, and how to reach it.
    await expect(main.getByRole('heading', { name: PRACTICE_NAME[locale] })).toBeVisible();
    await expect(main.getByRole('link', { name: portal.home.practicePage })).toHaveAttribute(
      'href',
      `/${locale}`,
    );
    // To the practice's free times. Not opened here: their chips fade in, and the page's own tests
    // wait that out before axe looks at their contrast.
    await expect(main.getByRole('link', { name: portal.home.book })).toHaveAttribute(
      'href',
      `/${locale}#free-times`,
    );
  });

  test('shows the next appointment with what can be done, then what comes after', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await homeWithAppointments(page, locale, newAddress(testInfo), 2);
    const next = page.getByRole('region', { name: portal.home.next });
    await expect(next.getByRole('link').filter({ hasText: SERVICE[locale] })).toBeVisible();
    await expect(
      next.getByRole('link', { name: startOf(portal.list.rescheduleLabel) }),
    ).toBeVisible();
    await expect(
      next.getByRole('button', { name: startOf(portal.list.cancelLabel) }),
    ).toBeVisible();
    await expect(next.getByRole('button', { name: portal.book.addToCalendar })).toBeVisible();
    const upcoming = page
      .getByRole('main')
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: portal.home.upcoming }) })
      .getByRole('listitem');
    await expect(upcoming).toHaveCount(1);
    await expect(upcoming).toContainText(SERVICE[locale]);
    await expect(page.getByRole('link', { name: portal.home.all })).toHaveAttribute(
      'href',
      `/${locale}/appointments`,
    );
  });

  test('a cancel of the next one: asks once more, says so, and the heading takes the focus', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await homeWithAppointments(page, locale, newAddress(testInfo), 1);
    await page
      .getByRole('region', { name: portal.home.next })
      .getByRole('button', { name: startOf(portal.list.cancelLabel) })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: portal.cancel.confirm }).click();
    await expect(heading(page)).toBeFocused();
    await expect(page.getByRole('main').getByRole('status')).toContainText(
      startOf(portal.cancel.done),
    );
    await expect(page.getByRole('main')).toContainText(portal.home.empty);
  });
});

test.describe('what B04 left (08 B06)', () => {
  test('a busy practice keeps Move, which waits out the Retry-After, and then moves', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { errors, portal } = messages[locale];
    await homeWithAppointments(page, locale, newAddress(testInfo), 1);
    await page
      .getByRole('region', { name: portal.home.next })
      .getByRole('link', { name: startOf(portal.list.rescheduleLabel) })
      .click();
    await page
      .getByRole('group', { name: messages[locale].practicePage.freeTimes.morning })
      .getByRole('link')
      .first()
      .click();
    let refused = false;
    await page.route(MOVE, async (route) => {
      if (refused) {
        await route.fallback();
        return;
      }
      refused = true;
      await route.fulfill(problem(503, 'SERVICE_UNAVAILABLE', 2));
    });
    const move = page.getByRole('button', { name: portal.reschedule.confirm });
    await move.click();
    const main = page.getByRole('main');
    await expect(main.getByRole('alert')).toHaveText(errors.SERVICE_UNAVAILABLE);
    // Nothing happened: the same press can follow, once the wait is over, and keeps the focus.
    await expect(move).toHaveAttribute('aria-disabled', 'true');
    await expect(move).toBeFocused();
    await expect(main).toContainText(startOf(messages[locale].common.tryAgainIn));
    await expect(move).not.toHaveAttribute('aria-disabled', 'true', { timeout: 5000 });
    await move.click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/appointments/[^/]+/[^/]+$`));
  });

  test('a "Try again" in the chooser hands the focus to the day', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const free = messages[locale].practicePage.freeTimes;
    const letPass = await refuseReads(page, AVAILABILITY);
    await page.goto(`/${locale}`);
    const retry = page.getByRole('button', { name: free.retry });
    await expect(retry).toBeVisible();
    await letPass();
    await retry.click();
    await expect(page.locator('#free-times').getByRole('heading', { level: 3 })).toBeFocused();
  });

  test('the chosen service keeps its name whole in a sentence, and typing still finds it', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const free = messages[locale].practicePage.freeTimes;
    await page.goto(`/${locale}`);
    const service = page.getByRole('button', { name: new RegExp(free.service) });
    const shown = service.locator('[data-slot="select-value"]');
    await expect(shown).toContainText(CHECK_UP);
    await service.focus();
    await page.keyboard.type('V');
    await expect(shown).toContainText(VACCINATION);
    expect(await shown.textContent()).toContain(
      `${FIRST_STRONG_ISOLATE}${VACCINATION}${POP_DIRECTIONAL_ISOLATE}`,
    );
  });

  test('a "Show more" that fails: another try takes the focus, then the first new row', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await joinPractice(page, locale);
    await hook('past-visit', { email, count: '21' });
    await page.goto(`/${locale}/appointments#tab=past`);
    const links = page.getByRole('tabpanel').getByRole('listitem').getByRole('link');
    await expect(links).toHaveCount(20);
    const letPass = await refuseReads(page, PAST_PAGE_AFTER_A_CURSOR);
    await page.getByRole('button', { name: portal.list.more }).click();
    const retry = page.getByRole('tabpanel').getByRole('button', { name: portal.list.retry });
    await expect(retry).toBeFocused();
    await letPass();
    await retry.click();
    await expect(links).toHaveCount(21);
    await expect(links.nth(20)).toBeFocused();
  });

  test('back from an appointment of the history: shows it again, and it takes the focus', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await joinPractice(page, locale);
    await hook('past-visit', { email, count: '25' });
    await page.goto(`/${locale}/appointments#tab=past`);
    const links = page.getByRole('tabpanel').getByRole('listitem').getByRole('link');
    await expect(links).toHaveCount(20);
    await page.getByRole('button', { name: portal.list.more }).click();
    await expect(links).toHaveCount(25);
    const opened = await links.nth(22).getAttribute('href');
    await links.nth(22).click();
    // Once the page has come to life: the way back reads the address's fragment. It names the
    // appointment, which the path names already, and no count of the history (security review).
    const back = page.getByRole('main').getByRole('link', { name: portal.details.back });
    await expect(back).toHaveAttribute(
      'href',
      /#tab=past&practice=[0-9a-f-]+&appointment=[0-9a-f-]+$/,
    );
    expect(await back.getAttribute('href')).not.toContain('pages');
    await back.click();
    await expect(links).toHaveCount(25);
    await expect(links.nth(22)).toBeFocused();
    expect(await links.nth(22).getAttribute('href')).toBe(opened);
  });

  test('a second "Try again" on the booking page moves the focus as the first did', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await signedIn(page, locale, newAddress(testInfo));
    await chooseTime(page, locale);
    await joinPractice(page, locale);
    const letPage = await refuseReads(page, PUBLIC_PAGE);
    const letPractices = await refuseReads(page, MY_PRACTICES);
    await page.reload();
    const retry = page.getByRole('main').getByRole('button', { name: portal.list.retry });
    await expect(retry).toBeVisible();
    await letPage();
    await retry.click();
    await expect(heading(page)).toBeFocused();
    // Now the list of practices, which failed too: another "Try again", and the focus again.
    await expect(retry).toBeVisible();
    await retry.focus();
    await letPractices();
    await retry.click();
    await expect(page.getByRole('heading', { name: portal.book.reviewTitle })).toBeVisible();
    await expect(heading(page)).toBeFocused();
  });

  test('a theme chosen in the account stays, on every page, from the first byte', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { account } = messages[locale].auth;
    await signedIn(page, locale, newAddress(testInfo));
    await page.goto(`/${locale}/account`);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'system');
    await page.getByRole('radio', { name: account.themeDark }).check({ force: true });
    await expect(html).toHaveAttribute('data-theme', 'dark');
    // The server renders the choice: what it sends is dark before any script runs.
    for (const path of [`/${locale}/account`, `/${locale}`]) {
      const answer = await page.request.get(path);
      expect(await answer.text()).toContain('data-theme="dark"');
    }
    await page.goto(`/${locale}`);
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.goto(`/${locale}/account`);
    await expect(page.getByRole('radio', { name: account.themeDark })).toBeChecked();
    await page.getByRole('radio', { name: account.themeSystem }).check({ force: true });
    await expect(html).toHaveAttribute('data-theme', 'system');
  });
});

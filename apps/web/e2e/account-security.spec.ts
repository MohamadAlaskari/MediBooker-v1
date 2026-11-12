import { messages } from '@medibooker/i18n';
import type { Page } from '@playwright/test';
import { confirm, hook, localeOf, newAddress, register, signedIn } from './support/journey';
import { expect, expectAccessibleAtBothWidths, test } from './support/test';

const PHONE = 'Firefox · Android';
const TABLET = 'Safari · iOS';

/** The token of a "this was not me" link the stub sent to this address. */
async function secureLinkOf(email: string): Promise<string> {
  const answer = await hook('secure-link', { email });
  return ((await answer.json()) as { token: string }).token;
}

function sessionsSection(page: Page, title: string) {
  return page.getByRole('region', { name: title });
}

test.describe('where an account is signed in (A04)', () => {
  test('lists every sign-in, ends one and then all others', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const texts = messages[locale].auth.account;
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await hook('sign-in-elsewhere', { email, device: PHONE });
    await hook('sign-in-elsewhere', { email, device: TABLET });
    await page.goto(`/${locale}/account`);

    const section = sessionsSection(page, texts.sessionsTitle);
    await expect(section.getByRole('listitem')).toHaveCount(3);
    await expect(section.getByText(texts.sessionCurrent)).toBeVisible();
    await expectAccessibleAtBothWidths(page, 'three sign-ins');

    // The button names the sign-in it ends, and starts with what it shows.
    const endPhone = section.getByRole('button', { name: new RegExp(PHONE) });
    await expect(endPhone).toHaveAccessibleName(new RegExp(`^${texts.sessionEnd}`));
    await endPhone.click();
    await expect(section.getByRole('status')).toHaveText(texts.sessionEnded);
    await expect(section.getByRole('status')).toBeFocused();
    await expect(section.getByText(PHONE)).toBeHidden();
    await expect(section.getByRole('listitem')).toHaveCount(2);

    await section.getByRole('button', { name: texts.sessionsEndOthers }).click();
    await expect(section.getByRole('status')).toHaveText(texts.sessionsEndedOthers);
    await expect(section.getByRole('status')).toBeFocused();
    await expect(section.getByRole('listitem')).toHaveCount(1);
    await expect(section.getByText(texts.sessionsOnlyThis)).toBeVisible();
    // This sign-in goes on.
    await page.reload();
    await expect(sessionsSection(page, texts.sessionsTitle).getByRole('listitem')).toHaveCount(1);
  });
});

test.describe('"this was not me" (E10)', () => {
  test('secures the account from the link of a security e-mail, once', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const texts = messages[locale].auth.secureAccount;
    const email = newAddress(testInfo);
    await register(email, locale);
    await confirm(email);
    const token = await secureLinkOf(email);

    await page.goto(`/${locale}/secure-account#token=${token}`);
    await expect(page.getByRole('heading', { level: 1, name: texts.title })).toBeVisible();
    // A link that works for a week stays in no address bar and no history.
    await expect(page).toHaveURL(`/${locale}/secure-account`);
    await expectAccessibleAtBothWidths(page, 'before');

    await page.getByRole('button', { name: texts.submit }).click();
    await expect(page.getByRole('heading', { level: 1, name: texts.doneTitle })).toBeVisible();
    // The old password works nowhere now, so the way on is a new one, not the sign-in.
    await expect(page.getByRole('link', { name: texts.newPassword })).toHaveAttribute(
      'href',
      `/${locale}/forgot-password`,
    );

    // The same link again, opened anew from the e-mail: it worked once.
    await page.goto('about:blank');
    await page.goto(`/${locale}/secure-account#token=${token}`);
    await page.getByRole('button', { name: texts.submit }).click();
    await expect(page.getByRole('heading', { level: 1, name: texts.noLinkTitle })).toBeVisible();
  });

  test('says so when the address has no token', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const texts = messages[locale].auth.secureAccount;
    await page.goto(`/${locale}/secure-account`);
    await expect(page.getByRole('heading', { level: 1, name: texts.noLinkTitle })).toBeVisible();
    await expect(page.getByRole('link', { name: texts.newPassword })).toHaveAttribute(
      'href',
      `/${locale}/forgot-password`,
    );
  });
});

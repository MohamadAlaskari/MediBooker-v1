import { messages } from '@medibooker/i18n';
import type { Page, TestInfo } from '@playwright/test';
import { API_STUB_PORT } from './support/ports';
import { expect, test } from './support/test';

const STUB = `http://127.0.0.1:${String(API_STUB_PORT)}`;
const PASSWORD = 'a synthetic passphrase';
const NEW_PASSWORD = 'another synthetic passphrase';

function localeOf({ project }: TestInfo): 'ar' | 'en' {
  return project.name.startsWith('ar') ? 'ar' : 'en';
}

function newAddress({ project, repeatEachIndex, retry, testId }: TestInfo): string {
  return `${project.name}-${testId}-${String(repeatEachIndex)}-${String(retry)}@example.test`;
}

async function linkOf(email: string, purpose: 'confirm' | 'reset'): Promise<string> {
  const answer = await fetch(`${STUB}/__links?email=${encodeURIComponent(email)}`);
  const links = (await answer.json()) as Record<string, string | undefined>;
  return links[purpose] ?? '';
}

function texts(locale: 'ar' | 'en') {
  return messages[locale].auth;
}

function emailField(page: Page, locale: 'ar' | 'en') {
  return page.getByLabel(texts(locale).emailLabel, { exact: true });
}

function passwordField(page: Page, locale: 'ar' | 'en') {
  return page.getByLabel(texts(locale).passwordLabel, { exact: true });
}

/** The box and not the label, whose middle may be the link to the privacy policy. */
async function acceptPrivacyPolicy(page: Page): Promise<void> {
  await page.locator('[data-slot="checkbox"] label > span[aria-hidden]').click();
}

async function signUp(page: Page, locale: 'ar' | 'en', email: string): Promise<void> {
  await emailField(page, locale).fill(email);
  await passwordField(page, locale).fill(PASSWORD);
  await acceptPrivacyPolicy(page);
  await page.getByRole('button', { name: texts(locale).signUp.submit }).click();
}

/** Screens 10 and 11, up to the insurance. */
async function enterPerson(page: Page, locale: 'ar' | 'en'): Promise<void> {
  const t = texts(locale).details;
  await page.getByLabel(t.firstName, { exact: true }).fill('Sara');
  await page.getByLabel(t.lastName, { exact: true }).fill('Ahmed');
  await page.getByLabel(t.dateOfBirth, { exact: true }).fill('1990-05-14');
  await page.getByRole('button', { name: t.continue }).click();
  await expect(page.getByRole('heading', { name: t.insuranceTitle })).toBeVisible();
}

async function enterInsurance(page: Page, locale: 'ar' | 'en'): Promise<void> {
  const t = texts(locale).details;
  await page.getByLabel(t.insuranceProvider, { exact: true }).fill('Al Noor Insurance');
  await page.getByLabel(t.insuranceNumber, { exact: true }).fill('AN-4821-77');
  await page.getByRole('button', { name: t.continue }).click();
}

async function signIn(page: Page, locale: 'ar' | 'en', email: string, password = PASSWORD) {
  await emailField(page, locale).fill(email);
  await passwordField(page, locale).fill(password);
  await page.getByRole('button', { name: texts(locale).signIn.submit }).click();
}

/** An account that exists, for whoever comes to sign in. */
async function existingAccount(testInfo: TestInfo): Promise<string> {
  const email = newAddress(testInfo);
  await fetch(`${STUB}/api/v1/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD, locale: localeOf(testInfo) }),
  });
  return email;
}

test.describe('signing up (08 A05)', () => {
  test('creates the account, signs in at once, and the link confirms it', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const t = texts(locale);
    const email = newAddress(testInfo);
    await page.goto(`/${locale}/sign-up`);
    await signUp(page, locale, email);

    await expect(page).toHaveURL(`/${locale}/sign-up/details`);
    await enterPerson(page, locale);
    await enterInsurance(page, locale);

    await expect(page).toHaveURL(`/${locale}/check-inbox`);
    await expect(page.getByRole('heading', { name: t.checkInbox.title })).toBeVisible();
    await expect(page.getByRole('main')).toContainText(email);

    await page.getByRole('link', { name: t.checkInbox.continue }).click();
    await expect(page).toHaveURL(`/${locale}/account`);
    await expect(page.getByText(t.account.notConfirmedTitle)).toBeVisible();

    await page.goto(`/${locale}/verify-email#token=${await linkOf(email, 'confirm')}`);
    await passwordField(page, locale).fill(PASSWORD);
    await page.getByRole('button', { name: t.verifyEmail.submit }).click();
    await expect(page.getByRole('heading', { name: t.verifyEmail.doneTitle })).toBeVisible();

    await page.getByRole('link', { name: t.verifyEmail.continue }).click();
    await expect(page.getByText(t.account.confirmed)).toBeVisible();
  });

  test('says what is wrong, in the language of the page, next to the field', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    await page.goto(`/${locale}/sign-up`);
    await page.getByRole('button', { name: texts(locale).signUp.submit }).click();
    await expect(emailField(page, locale)).toHaveAttribute('aria-invalid', 'true');
    await expect(emailField(page, locale)).toBeFocused();
    await expect(page.getByText(messages[locale].validation.REQUIRED).first()).toBeVisible();
    await expect(page.getByText(texts(locale).signUp.consentRequired)).toBeVisible();

    await emailField(page, locale).fill('not-an-address');
    await passwordField(page, locale).fill('short');
    await page.getByRole('button', { name: texts(locale).signUp.submit }).click();
    await expect(page.getByText(messages[locale].validation.INVALID_FORMAT)).toBeVisible();
    await expect(passwordField(page, locale)).toHaveAccessibleDescription(/10|١٠/);
  });

  test('shows the answer of the API about a password next to its field', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    await page.goto(`/${locale}/sign-up`);
    await emailField(page, locale).fill(newAddress(testInfo));
    await passwordField(page, locale).fill('1234567890');
    await acceptPrivacyPolicy(page);
    await page.getByRole('button', { name: texts(locale).signUp.submit }).click();
    await expect(page.getByText(messages[locale].validation.PASSWORD_BREACHED)).toBeVisible();
    await expect(passwordField(page, locale)).toBeFocused();
  });

  test('says how to go on when the address has an account with another password', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const email = await existingAccount(testInfo);
    await page.goto(`/${locale}/sign-up`);
    await emailField(page, locale).fill(email);
    await passwordField(page, locale).fill(NEW_PASSWORD);
    await acceptPrivacyPolicy(page);
    await page.getByRole('button', { name: texts(locale).signUp.submit }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      texts(locale).signUp.forgot,
    );
    await expect(page).toHaveURL(`/${locale}/sign-up`);
  });

  test('does not take the confirmation without the right password', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const email = await existingAccount(testInfo);
    await page.goto(`/${locale}/verify-email#token=${await linkOf(email, 'confirm')}`);
    await passwordField(page, locale).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: texts(locale).verifyEmail.submit }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      messages[locale].errors.INVALID_CREDENTIALS,
    );
    // The way back for an owner whose address someone else signed up with.
    await expect(page.getByRole('link', { name: texts(locale).verifyEmail.forgot })).toBeVisible();
  });

  test('explains a link without its token', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    await page.goto(`/${locale}/verify-email`);
    await expect(page.getByText(texts(locale).verifyEmail.noLinkBody)).toBeVisible();
    await page.goto(`/${locale}/reset-password`);
    await expect(page.getByText(texts(locale).reset.noLinkBody)).toBeVisible();
  });
});

test.describe('the details of a person (D16)', () => {
  async function atDetails(page: Page, testInfo: TestInfo): Promise<'ar' | 'en'> {
    const locale = localeOf(testInfo);
    await page.goto(`/${locale}/sign-up`);
    await signUp(page, locale, newAddress(testInfo));
    await expect(page).toHaveURL(`/${locale}/sign-up/details`);
    return locale;
  }

  test('asks a self-payer for no insurance', async ({ page }, testInfo) => {
    const locale = await atDetails(page, testInfo);
    const t = texts(locale).details;
    await enterPerson(page, locale);
    await expect(page.getByLabel(t.insuranceNumber, { exact: true })).toBeVisible();
    await page.locator('[data-slot="radio-group"] label').filter({ hasText: t.SELF_PAY }).click();
    await expect(page.getByLabel(t.insuranceNumber, { exact: true })).toBeHidden();
    await page.getByRole('button', { name: t.continue }).click();
    await expect(page).toHaveURL(`/${locale}/check-inbox`);
  });

  test('asks for what an insured person left out, in their language', async ({
    page,
  }, testInfo) => {
    const locale = await atDetails(page, testInfo);
    const t = texts(locale).details;
    await page.getByRole('button', { name: t.continue }).click();
    await expect(page.getByLabel(t.firstName, { exact: true })).toBeFocused();
    await expect(page.getByText(messages[locale].validation.REQUIRED).first()).toBeVisible();

    await enterPerson(page, locale);
    await page.getByRole('button', { name: t.continue }).click();
    await expect(page.getByLabel(t.insuranceProvider, { exact: true })).toBeFocused();
    await expect(page).toHaveURL(`/${locale}/sign-up/details`);
  });

  test('goes back to the step the API found wrong', async ({ page }, testInfo) => {
    const locale = await atDetails(page, testInfo);
    const t = texts(locale).details;
    await page.getByLabel(t.firstName, { exact: true }).fill('Sara');
    await page.getByLabel(t.lastName, { exact: true }).fill('Ahmed');
    await page.getByLabel(t.dateOfBirth, { exact: true }).fill('2030-01-01');
    await page.getByRole('button', { name: t.continue }).click();
    await enterInsurance(page, locale);
    await expect(page.getByRole('heading', { name: t.title })).toBeVisible();
    await expect(page.getByText(messages[locale].validation.INVALID_VALUE)).toBeVisible();
  });

  test('can be left and finished later, and then changed', async ({ page }, testInfo) => {
    const locale = await atDetails(page, testInfo);
    const account = texts(locale).account;
    const t = texts(locale).details;
    await page.goto(`/${locale}/account`);
    await page.getByRole('link', { name: account.completeAction }).click();
    await enterPerson(page, locale);
    await page.getByLabel(t.insuranceProvider, { exact: true }).fill('Al Noor Insurance');
    await page.getByLabel(t.insuranceNumber, { exact: true }).fill('AN-4821-77');
    await page.getByRole('button', { name: t.save }).click();
    await expect(page).toHaveURL(`/${locale}/account`);
    await expect(page.getByText('Sara Ahmed')).toBeVisible();

    await page.getByRole('link', { name: account.changeDetails }).click();
    await page.getByLabel(t.firstName, { exact: true }).fill('Salma');
    await page.getByRole('button', { name: t.continue }).click();
    // The number stays out of the form: only its end is known here.
    await expect(page.getByLabel(t.insuranceNumber, { exact: true })).toHaveValue('');
    await expect(page.getByRole('main')).toContainText('4821-77'.slice(-4));
    await page.getByRole('button', { name: t.save }).click();
    await expect(page.getByText('Salma Ahmed')).toBeVisible();
  });

  test('keeps nothing of them in web storage', async ({ page }, testInfo) => {
    const locale = await atDetails(page, testInfo);
    await enterPerson(page, locale);
    const stored = await page.evaluate(() => localStorage.length + sessionStorage.length);
    expect(stored).toBe(0);
  });

  test('lets who mistyped delete the account, after asking once more', async ({
    page,
  }, testInfo) => {
    const locale = await atDetails(page, testInfo);
    const account = texts(locale).account;
    await page.goto(`/${locale}/account`);
    await page.getByRole('button', { name: account.wrongAddress }).click();
    await page.getByRole('button', { name: account.keepAccount }).click();
    await expect(page.getByRole('heading', { name: account.title })).toBeVisible();

    await page.getByRole('button', { name: account.wrongAddress }).click();
    await page.getByRole('button', { name: account.deleteAccount }).click();
    await expect(page).toHaveURL(`/${locale}/sign-up`);
    await page.goto(`/${locale}/account`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/sign-in`));
  });

  test('offers no such deletion once the address is confirmed', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const t = texts(locale);
    const email = await existingAccount(testInfo);
    await page.goto(`/${locale}/verify-email#token=${await linkOf(email, 'confirm')}`);
    await passwordField(page, locale).fill(PASSWORD);
    await page.getByRole('button', { name: t.verifyEmail.submit }).click();
    await expect(page.getByRole('heading', { name: t.verifyEmail.doneTitle })).toBeVisible();
    await page.goto(`/${locale}/sign-in`);
    await signIn(page, locale, email);
    await expect(page.getByText(t.account.confirmed)).toBeVisible();
    await expect(page.getByRole('button', { name: t.account.wrongAddress })).toBeHidden();
  });
});

test.describe('signing up when the API has something else to say (08 A05)', () => {
  test('does not call a limit an existing account', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/problem+json',
        body: JSON.stringify({ code: 'RATE_LIMITED', status: 429 }),
      }),
    );
    await page.goto(`/${locale}/sign-up`);
    await signUp(page, locale, newAddress(testInfo));
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      messages[locale].errors.RATE_LIMITED,
    );
  });

  test('shows an error about a field the form does not have', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    await page.route('**/api/v1/auth/register', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          code: 'VALIDATION_FAILED',
          status: 400,
          errors: [{ field: 'privacyNoticeVersion', code: 'INVALID_VALUE' }],
        }),
      }),
    );
    await page.goto(`/${locale}/sign-up`);
    await signUp(page, locale, newAddress(testInfo));
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      messages[locale].errors.VALIDATION_FAILED,
    );
  });
});

test.describe('signing in and out (08 A05)', () => {
  test('keeps tokens out of reach of a script, and away from web storage', async ({
    page,
    context,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    await page.goto(`/${locale}/sign-in`);
    await signIn(page, locale, await existingAccount(testInfo));
    await expect(page).toHaveURL(`/${locale}/account`);

    const cookies = await context.cookies();
    const byName = new Map(cookies.map((cookie) => [cookie.name, cookie]));
    for (const name of ['mb_access', 'mb_refresh', 'mb_csrf']) {
      expect(byName.get(name)).toMatchObject({ secure: true, sameSite: 'Strict' });
    }
    expect(byName.get('mb_access')?.httpOnly).toBe(true);
    expect(byName.get('mb_refresh')?.httpOnly).toBe(true);
    const stored = await page.evaluate(() => localStorage.length + sessionStorage.length);
    expect(stored).toBe(0);
    const readable = await page.evaluate(() => document.cookie);
    expect(readable).not.toContain('mb_access');
    expect(readable).not.toContain('mb_refresh');
  });

  test('gives one answer for a wrong password', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    await page.goto(`/${locale}/sign-in`);
    await signIn(page, locale, await existingAccount(testInfo), NEW_PASSWORD);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      messages[locale].errors.INVALID_CREDENTIALS,
    );
    await expect(page).toHaveURL(`/${locale}/sign-in`);
  });

  test('signs out, and the account page then asks for a sign-in', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    await page.goto(`/${locale}/sign-in`);
    await signIn(page, locale, await existingAccount(testInfo));
    await page.getByRole('button', { name: texts(locale).account.signOut }).click();
    await expect(page).toHaveURL(`/${locale}/sign-in`);

    await page.goto(`/${locale}/account`);
    await expect(page).toHaveURL(
      `/${locale}/sign-in#next=${encodeURIComponent(`/${locale}/account`)}`,
    );
  });

  test('goes on by itself when only the access token is over', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const email = await existingAccount(testInfo);
    await page.goto(`/${locale}/sign-in`);
    await signIn(page, locale, email);
    await expect(page.getByRole('main')).toContainText(email);

    await fetch(`${STUB}/__end-access?email=${encodeURIComponent(email)}`);
    await page.reload();
    await expect(page.getByRole('main')).toContainText(email);
    await expect(page).toHaveURL(`/${locale}/account`);
  });

  test('asks for a sign-in when the session is over, and comes back', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const email = await existingAccount(testInfo);
    await page.goto(`/${locale}/sign-in`);
    await signIn(page, locale, email);
    await expect(page.getByRole('main')).toContainText(email);

    await fetch(`${STUB}/__end-sessions?email=${encodeURIComponent(email)}`);
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/${locale}/sign-in#next=`));
    await signIn(page, locale, email);
    await expect(page).toHaveURL(`/${locale}/account`);
  });

  test('shows and hides the password, with a target of 44 px', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const t = texts(locale);
    await page.goto(`/${locale}/sign-in`);
    await passwordField(page, locale).fill(PASSWORD);
    await expect(passwordField(page, locale)).toHaveAttribute('type', 'password');
    const show = page.getByRole('button', { name: t.showPassword });
    const box = await show.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await show.click();
    await expect(passwordField(page, locale)).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: t.hidePassword }).click();
    await expect(passwordField(page, locale)).toHaveAttribute('type', 'password');
  });
});

test.describe('the way back from a practice page (08 A05)', () => {
  test('returns to the practice after signing in', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const practice = `/${locale}/al-noor`;
    await page.goto(`/${locale}/sign-in#next=${encodeURIComponent(practice)}`);
    await signIn(page, locale, await existingAccount(testInfo));
    await expect(page).toHaveURL(practice);
  });

  test('comes back to the free times, the section the person left', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const practice = encodeURIComponent(`/${locale}/al-noor`);
    // The section is in view at once, so its reveal must not be what the page is judged by.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/${locale}/sign-in#next=${practice}&section=free-times`);
    await signIn(page, locale, await existingAccount(testInfo));
    await expect(page).toHaveURL(`/${locale}/al-noor#free-times`);
  });

  test('takes nothing but a section for one', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const practice = encodeURIComponent(`/${locale}/al-noor`);
    const section = encodeURIComponent('x/../../evil');
    await page.goto(`/${locale}/sign-in#next=${practice}&section=${section}`);
    await signIn(page, locale, await existingAccount(testInfo));
    await expect(page).toHaveURL(`/${locale}/al-noor`);
  });

  test('stays with a person who has to sign up first', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const practice = `/${locale}/al-noor`;
    const t = texts(locale);
    await page.goto(`/${locale}/sign-in#next=${encodeURIComponent(practice)}`);
    await page.getByRole('link', { name: t.signIn.createAccount }).click();
    await expect(page.getByRole('heading', { name: t.signUp.title })).toBeVisible();
    await signUp(page, locale, newAddress(testInfo));
    await enterPerson(page, locale);
    await enterInsurance(page, locale);
    await expect(page).toHaveURL(new RegExp(`/${locale}/check-inbox#next=`));
    await page.getByRole('link', { name: t.checkInbox.continue }).click();
    await expect(page).toHaveURL(practice);
  });

  test('never leads away from this site', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    await page.goto(`/${locale}/sign-in#next=${encodeURIComponent('//evil.example/en/x')}`);
    await signIn(page, locale, await existingAccount(testInfo));
    await expect(page).toHaveURL(`/${locale}/account`);
  });

  test('is not for search engines', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    for (const path of ['sign-in', 'sign-up', 'forgot-password', 'privacy']) {
      await page.goto(`/${locale}/${path}`);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    }
  });
});

test.describe('a forgotten password (08 A05)', () => {
  test('sets a new one through the link, and the old one is over', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const t = texts(locale);
    const email = await existingAccount(testInfo);
    await page.goto(`/${locale}/sign-in`);
    await page.getByRole('link', { name: t.signIn.forgot }).click();
    await expect(page.getByRole('heading', { name: t.forgot.title })).toBeVisible();
    await emailField(page, locale).fill(email);
    await page.getByRole('button', { name: t.forgot.submit }).click();
    await expect(page.getByRole('heading', { name: t.forgot.doneTitle })).toBeVisible();

    await page.goto(`/${locale}/reset-password#token=${await linkOf(email, 'reset')}`);
    await page.getByLabel(t.newPasswordLabel, { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: t.reset.submit }).click();
    await expect(page.getByRole('heading', { name: t.reset.doneTitle })).toBeVisible();

    await page.getByRole('link', { name: t.reset.signIn }).click();
    await signIn(page, locale, email);
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
    await signIn(page, locale, email, NEW_PASSWORD);
    await expect(page).toHaveURL(`/${locale}/account`);
  });

  test('answers the same for an address without an account', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const t = texts(locale);
    await page.goto(`/${locale}/forgot-password`);
    await emailField(page, locale).fill(newAddress(testInfo));
    await page.getByRole('button', { name: t.forgot.submit }).click();
    await expect(page.getByRole('heading', { name: t.forgot.doneTitle })).toBeVisible();
  });

  test('keeps the token when the language changes', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const other = locale === 'ar' ? 'en' : 'ar';
    await page.goto(`/${locale}/reset-password#token=a-token`);
    await page.locator(`a[hreflang="${other}"]`).click();
    await expect(page).toHaveURL(`/${other}/reset-password#token=a-token`);
    await expect(page.locator('html')).toHaveAttribute('dir', other === 'ar' ? 'rtl' : 'ltr');
  });
});

test.describe('before the page has come to life (08 A05)', () => {
  test.use({ javaScriptEnabled: false });

  test('cannot send a password by itself', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    for (const path of ['sign-in', 'sign-up', 'reset-password', 'verify-email']) {
      await page.goto(`/${locale}/${path}`);
      for (const button of await page.locator('form button[type="submit"]').all()) {
        await expect(button).toBeDisabled();
      }
      // Whatever is typed now would be lost, so nothing can be typed yet.
      for (const field of await page.locator('form input:not([type="checkbox"])').all()) {
        await expect(field).not.toBeEditable();
      }
      for (const form of await page.locator('form').all()) {
        await expect(form).toHaveAttribute('method', 'post');
      }
    }
  });
});

test.describe('on a phone (08 A05)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('fits the screen, without the brand panel', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    for (const path of ['sign-in', 'sign-up', 'forgot-password']) {
      await page.goto(`/${locale}/${path}`);
      await expect(page.locator('aside')).toBeHidden();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

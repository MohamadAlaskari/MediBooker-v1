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

function otherThan(locale: 'ar' | 'en'): 'ar' | 'en' {
  return locale === 'ar' ? 'en' : 'ar';
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

/** Signed in without another way back: the page has come to life, and has read what it needs. */
async function atAppointments(page: Page, locale: 'ar' | 'en'): Promise<void> {
  await expect(page).toHaveURL(`/${locale}/appointments`);
  await expect(page.getByRole('main')).toContainText(messages[locale].portal.list.noPractices);
}

/** What a person chose on a practice's page, just now: only what ends a session removes it here. */
async function keepAChoice(page: Page): Promise<void> {
  await page.evaluate(() => {
    sessionStorage.setItem('medibooker.booking-choice', JSON.stringify({ savedAt: Date.now() }));
  });
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
    await expect(page.getByRole('main')).toContainText('2177');
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

    await keepAChoice(page);
    await page.getByRole('button', { name: account.wrongAddress }).click();
    await page.getByRole('button', { name: account.deleteAccount }).click();
    // Who mistyped wants to sign up again, not to sign in.
    await expect(page).toHaveURL(`/${locale}/sign-up`);
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
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
    await page.goto(`/${locale}/account`);
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
    await expect(page).toHaveURL(`/${locale}/appointments`);

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
    await atAppointments(page, locale);
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
    await page.goto(`/${locale}/account`);
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
    await page.goto(`/${locale}/account`);
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
    const practice = `/${locale}`;
    await page.goto(`/${locale}/sign-in#next=${encodeURIComponent(practice)}`);
    await signIn(page, locale, await existingAccount(testInfo));
    await expect(page).toHaveURL(practice);
  });

  test('stays with a person who has to sign up first', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const practice = `/${locale}`;
    const t = texts(locale);
    await page.goto(`/${locale}/sign-in#next=${encodeURIComponent(practice)}`);
    await page.getByRole('link', { name: t.signIn.createAccount }).click();
    await expect(page.getByRole('heading', { name: t.signUp.title })).toBeVisible();
    await signUp(page, locale, newAddress(testInfo));
    await enterPerson(page, locale);
    await enterInsurance(page, locale);
    await expect(page).toHaveURL(new RegExp(`/${locale}/check-inbox#next=`));
    await expect(page.getByRole('link', { name: t.checkInbox.continueToBooking })).toHaveCount(0);
    await page.getByRole('link', { name: t.checkInbox.continueOn }).click();
    await expect(page).toHaveURL(practice);
  });

  test('calls the way back a booking only when it leads to one', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const t = texts(locale);
    const booking = `/${locale}/book/al-noor`;
    await page.goto(`/${locale}/sign-up#next=${encodeURIComponent(booking)}`);
    await signUp(page, locale, newAddress(testInfo));
    await enterPerson(page, locale);
    await enterInsurance(page, locale);
    await expect(page).toHaveURL(new RegExp(`/${locale}/check-inbox#next=`));
    await expect(page.getByRole('link', { name: t.checkInbox.continueToBooking })).toHaveAttribute(
      'href',
      booking,
    );
  });

  test('a language switch on the way: lands in the language chosen', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const other = otherThan(locale);
    const way = encodeURIComponent(`/${locale}`);
    await page.goto(`/${locale}/sign-in#next=${way}`);
    await page.locator(`a[hreflang="${other}"]`).click();
    await expect(page).toHaveURL(`/${other}/sign-in#next=${way}`);
    await signIn(page, other, await existingAccount(testInfo));
    await expect(page).toHaveURL(`/${other}`);
  });

  test('a way back in another language: lands in the language of this page', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const way = encodeURIComponent(`/${otherThan(locale)}/book/al-noor`);
    await page.goto(`/${locale}/sign-in#next=${way}`);
    await signIn(page, locale, await existingAccount(testInfo));
    await expect(page).toHaveURL(`/${locale}/book/al-noor`);
  });

  test('a forgotten password on the way keeps it, there and back', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const t = texts(locale);
    const practice = `/${locale}`;
    const way = encodeURIComponent(practice);
    await page.goto(`/${locale}/sign-in#next=${way}`);
    await page.getByRole('link', { name: t.signIn.forgot }).click();
    await expect(page).toHaveURL(`/${locale}/forgot-password#next=${way}`);
    await page.getByRole('link', { name: t.forgot.back }).click();
    await expect(page).toHaveURL(`/${locale}/sign-in#next=${way}`);
    await signIn(page, locale, await existingAccount(testInfo));
    await expect(page).toHaveURL(practice);
  });

  test('a session that ends on the e-mail step keeps the way back it had', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const email = await existingAccount(testInfo);
    const way = encodeURIComponent(`/${locale}`);
    await page.goto(`/${locale}/sign-in`);
    await signIn(page, locale, email);
    await expect(page).toHaveURL(`/${locale}/appointments`);
    await page.goto(`/${locale}/check-inbox#next=${way}`);
    await expect(page.getByRole('main')).toContainText(email);

    await fetch(`${STUB}/__end-sessions?email=${encodeURIComponent(email)}`);
    await page.reload();
    await expect(page).toHaveURL(`/${locale}/sign-in#next=${way}`);
  });

  test('never leads away from this site', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    await page.goto(`/${locale}/sign-in#next=${encodeURIComponent('//evil.example/en/x')}`);
    await signIn(page, locale, await existingAccount(testInfo));
    await expect(page).toHaveURL(`/${locale}/appointments`);
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
    await expect(page).toHaveURL(`/${locale}/appointments`);
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

test.describe('the skip link (08 B04)', () => {
  /** The first stop of the keyboard, pressed. */
  async function skip(page: Page, locale: 'ar' | 'en'): Promise<void> {
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: messages[locale].a11y.skipToContent }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  }

  test('keeps the way back in the fragment, and signing in lands on it', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const practice = `/${locale}`;
    const way = encodeURIComponent(practice);
    await page.goto(`/${locale}/sign-in#next=${way}`);
    await expect(page.getByRole('button', { name: texts(locale).signIn.submit })).toBeEnabled();
    await skip(page, locale);
    await expect(page).toHaveURL(`/${locale}/sign-in#next=${way}`);
    await signIn(page, locale, await existingAccount(testInfo));
    await expect(page).toHaveURL(practice);
  });

  for (const path of ['verify-email', 'reset-password']) {
    test(`keeps the token of a link and its form on /${path}`, async ({ page }, testInfo) => {
      const locale = localeOf(testInfo);
      await page.goto(`/${locale}/${path}#token=a-token`);
      const submit = page.locator('form button[type="submit"]');
      await expect(submit).toBeEnabled();
      await skip(page, locale);
      await expect(page).toHaveURL(`/${locale}/${path}#token=a-token`);
      await expect(submit).toBeVisible();
    });
  }
});

test.describe('signing out reaches every tab (08 B04)', () => {
  // What each shows once it has read what it needs: a question still on its way when the session
  // ends would find that out by itself, and keep this page as the way back.
  const tabs = [
    { path: 'account/details', shows: (locale: 'ar' | 'en') => texts(locale).details.continue },
    {
      path: 'appointments',
      shows: (locale: 'ar' | 'en') => messages[locale].portal.list.noPractices,
    },
    { path: 'check-inbox', shows: (locale: 'ar' | 'en') => texts(locale).checkInbox.resend },
  ];
  for (const { path, shows } of tabs) {
    test(`a tab on /${path} lands on signing in`, async ({ page, context }, testInfo) => {
      const locale = localeOf(testInfo);
      await page.goto(`/${locale}/sign-in`);
      await signIn(page, locale, await existingAccount(testInfo));
      await atAppointments(page, locale);

      const other = await context.newPage();
      await other.goto(`/${locale}/${path}`);
      await expect(other.getByRole('main')).toContainText(shows(locale));
      await page.getByRole('button', { name: texts(locale).account.signOut }).click();
      await expect(page).toHaveURL(`/${locale}/sign-in`);
      await expect(other).toHaveURL(`/${locale}/sign-in`);
    });
  }

  test('a stored choice ends with it', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    await page.goto(`/${locale}/sign-in`);
    await signIn(page, locale, await existingAccount(testInfo));
    await atAppointments(page, locale);
    await keepAChoice(page);
    await page.getByRole('button', { name: texts(locale).account.signOut }).click();
    await expect(page).toHaveURL(`/${locale}/sign-in`);
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  });

  test('signing in elsewhere renews a tab left open, without what it kept', async ({
    page,
    context,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    // Open since before anyone signed in, as on a shared computer: nothing has sent it away.
    const other = await context.newPage();
    await other.goto(`/${locale}/sign-in`);

    const email = await existingAccount(testInfo);
    await page.goto(`/${locale}/sign-in`);
    await signIn(page, locale, email);
    await atAppointments(page, locale);
    await keepAChoice(page);

    const renewed = page.waitForEvent('load');
    await signIn(other, locale, email);
    await atAppointments(other, locale);
    await renewed;
    await atAppointments(page, locale);
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  });
});

test.describe('a form that waits for its answer (08 B04)', () => {
  /** Keeps what is sent to a route waiting until the test lets go, and counts it. */
  async function holdAndCount(
    page: Page,
    url: string,
  ): Promise<{ readonly letGo: () => void; readonly sent: () => number }> {
    let count = 0;
    let letGo = (): void => undefined;
    const waiting = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    await page.route(url, async (route) => {
      count += 1;
      await waiting;
      await route.fallback();
    });
    return { letGo, sent: () => count };
  }

  test('Enter twice in a single field asks once', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const t = texts(locale);
    const { letGo, sent } = await holdAndCount(page, '**/api/v1/auth/password/forgot');
    await page.goto(`/${locale}/forgot-password`);
    await emailField(page, locale).fill(newAddress(testInfo));
    await emailField(page, locale).press('Enter');
    const submit = page.getByRole('button', { name: t.forgot.submit });
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
    await emailField(page, locale).press('Enter');
    letGo();
    await expect(page.getByRole('heading', { name: t.forgot.doneTitle })).toBeVisible();
    expect(sent()).toBe(1);
  });

  test('a token that works once is not sent twice', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const t = texts(locale);
    const email = await existingAccount(testInfo);
    await fetch(`${STUB}/api/v1/auth/password/forgot`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    const { letGo, sent } = await holdAndCount(page, '**/api/v1/auth/password/reset');
    await page.goto(`/${locale}/reset-password#token=${await linkOf(email, 'reset')}`);
    const password = page.getByLabel(t.newPasswordLabel, { exact: true });
    await password.fill(NEW_PASSWORD);
    await password.press('Enter');
    await expect(page.getByRole('button', { name: t.reset.submit })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await password.press('Enter');
    letGo();
    await expect(page.getByRole('heading', { name: t.reset.doneTitle })).toBeVisible();
    expect(sent()).toBe(1);
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

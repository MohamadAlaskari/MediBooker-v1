import { messages } from '@medibooker/i18n';
import type { Page, TestInfo } from '@playwright/test';
import { STUB_CODE, STUB_RECOVERY_CODE } from './support/auth-stub';
import { API_STUB_PORT } from './support/ports';
import { expect, expectAccessibleAtBothWidths, test } from './support/test';

const STUB = `http://127.0.0.1:${String(API_STUB_PORT)}`;
const PASSWORD = 'a synthetic passphrase';

type Locale = 'ar' | 'en';

function localeOf({ project }: TestInfo): Locale {
  return project.name.startsWith('ar') ? 'ar' : 'en';
}

function texts(locale: Locale) {
  return messages[locale].auth;
}

/** A staff account as the operator's command leaves it: a role, and maybe a second factor. */
async function staffAccount(
  testInfo: TestInfo,
  { role, secondFactor }: { readonly role?: string; readonly secondFactor?: boolean },
): Promise<string> {
  const { project, repeatEachIndex, retry, testId } = testInfo;
  const email = `${project.name}-${testId}-${String(repeatEachIndex)}-${String(retry)}@example.test`;
  const query = `email=${encodeURIComponent(email)}`;
  await fetch(`${STUB}/api/v1/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD, locale: localeOf(testInfo) }),
  });
  if (role !== undefined) await fetch(`${STUB}/__staff?${query}&role=${role}`);
  if (secondFactor === true) await fetch(`${STUB}/__second-factor?${query}`);
  return email;
}

/** The dashboard asks for a sign-in first, and comes back to itself after it. */
async function signInFromDashboard(page: Page, locale: Locale, email: string): Promise<void> {
  await page.goto(`/${locale}/dashboard`);
  await expect(page).toHaveURL(
    `/${locale}/sign-in#next=${encodeURIComponent(`/${locale}/dashboard`)}`,
  );
  await page.getByLabel(texts(locale).emailLabel, { exact: true }).fill(email);
  await page.getByLabel(texts(locale).passwordLabel, { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: texts(locale).signIn.submit }).click();
}

function roleText(locale: Locale, role: string): RegExp {
  const sentence = texts(locale).dashboard.signedInAs;
  const word = new RegExp(`${role} \\{([^}]*)\\}`).exec(sentence)?.[1] ?? role;
  return new RegExp(word.replaceAll('/', '\\/'));
}

test.describe('the practice dashboard (08 A04)', () => {
  test('sets up two-step sign-in with the QR code, then shows the role', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const t = texts(locale).twoFactor;
    await signInFromDashboard(page, locale, await staffAccount(testInfo, { role: 'ADMIN' }));
    await expect(page).toHaveURL(`/${locale}/dashboard`);
    await expect(page.getByRole('heading', { name: t.title })).toBeVisible();
    await page.getByRole('button', { name: t.start }).click();

    await expect(page.getByRole('img', { name: t.qrLabel })).toBeVisible();
    await expect(page.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeVisible();
    await expectAccessibleAtBothWidths(page, 'the QR code');
    await page.getByLabel(t.confirmLabel, { exact: true }).fill('000000');
    await page.getByRole('button', { name: t.confirm }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      messages[locale].errors.MFA_CODE_INVALID,
    );
    await page.getByLabel(t.confirmLabel, { exact: true }).fill(STUB_CODE);
    await page.getByRole('button', { name: t.confirm }).click();

    const codes = page.getByRole('list', { name: t.recoveryList });
    await expect(codes.getByRole('listitem')).toHaveCount(10);
    await expect(codes).toContainText(STUB_RECOVERY_CODE);
    await page.getByRole('button', { name: t.done }).click();
    await expect(page.getByRole('heading', { name: texts(locale).dashboard.title })).toBeVisible();
    await expect(page.getByRole('main')).toContainText(roleText(locale, 'ADMIN'));
    const stored = await page.evaluate(() => localStorage.length + sessionStorage.length);
    expect(stored).toBe(0);
  });

  test('asks for the code after the password, and takes a recovery code', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const t = texts(locale).signIn;
    const email = await staffAccount(testInfo, { role: 'STAFF', secondFactor: true });
    await signInFromDashboard(page, locale, email);
    await expect(page.getByRole('heading', { name: t.codeTitle })).toBeFocused();
    const code = page.getByLabel(t.codeLabel, { exact: true });
    await expect(code).toHaveAttribute('dir', 'ltr');
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await code.fill('000000');
    await page.getByRole('button', { name: t.verify }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      messages[locale].errors.MFA_CODE_INVALID,
    );
    await expectAccessibleAtBothWidths(page, 'the code step');

    await page.getByRole('button', { name: t.useRecovery }).click();
    await page
      .getByLabel(t.recoveryLabel, { exact: true })
      .fill(` ${STUB_RECOVERY_CODE.toUpperCase()} `);
    await page.getByRole('button', { name: t.verify }).click();
    await expect(page).toHaveURL(`/${locale}/dashboard`);
    await expect(page.getByRole('main')).toContainText(roleText(locale, 'STAFF'));
  });

  test('goes back from the code step to the password', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const t = texts(locale).signIn;
    await signInFromDashboard(
      page,
      locale,
      await staffAccount(testInfo, { role: 'DOCTOR', secondFactor: true }),
    );
    await page.getByRole('button', { name: t.back }).click();
    await expect(page.getByRole('heading', { name: t.title })).toBeVisible();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  });

  test('offers an account outside the team no setup of the app', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    await signInFromDashboard(page, locale, await staffAccount(testInfo, {}));
    await page.getByRole('button', { name: texts(locale).twoFactor.start }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      texts(locale).dashboard.noAccessTitle,
    );
    await expect(page.getByRole('img', { name: texts(locale).twoFactor.qrLabel })).toHaveCount(0);
  });

  test('tells an account outside the team that it has no access', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    await signInFromDashboard(page, locale, await staffAccount(testInfo, { secondFactor: true }));
    await page.getByLabel(texts(locale).signIn.codeLabel, { exact: true }).fill(STUB_CODE);
    await page.getByRole('button', { name: texts(locale).signIn.verify }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      texts(locale).dashboard.noAccessTitle,
    );
    await expect(page.getByRole('button', { name: texts(locale).account.signOut })).toBeVisible();
  });
});

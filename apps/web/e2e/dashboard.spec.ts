import { messages } from '@medibooker/i18n';
import type { Page, TestInfo } from '@playwright/test';
import { STUB_CODE, STUB_RECOVERY_CODE } from './support/auth-stub';
import { API_STUB_PORT } from './support/ports';
import { expect, expectAccessibleAtBothWidths, test } from './support/test';

const STUB = `http://127.0.0.1:${String(API_STUB_PORT)}`;
const PASSWORD = 'a synthetic passphrase';
const NOTE = 'Synthetic note: I may come ten minutes late.';

type Locale = 'ar' | 'en';
/** A base role, or one with practice management (D17): MANAGER is the practice team's. */
type Role = 'STAFF' | 'DOCTOR' | 'MANAGER' | 'MANAGING_DOCTOR';

/** The operator's command as the stub takes it: a base role, and practice management. */
const PLACES: Readonly<Record<Role, string>> = {
  STAFF: 'role=STAFF',
  DOCTOR: 'role=DOCTOR',
  MANAGER: 'role=STAFF&manages=true',
  MANAGING_DOCTOR: 'role=DOCTOR&manages=true',
};

function localeOf({ project }: TestInfo): Locale {
  return project.name.startsWith('ar') ? 'ar' : 'en';
}

function texts(locale: Locale) {
  return messages[locale].auth;
}

function desk(locale: Locale) {
  return messages[locale].dashboard;
}

/** The words of one case of an ICU select, as a screen shows them. */
function selected(message: string, key: string): string {
  return new RegExp(`${key} \\{([^}]*)\\}`).exec(message)?.[1] ?? key;
}

/** "Showing 21–25 of 25" in the stub's Latin digits. */
function showing(message: string, from: number, to: number, total: number): string {
  return message
    .replace('{from}', String(from))
    .replace('{to}', String(to))
    .replace('{total}', String(total));
}

/** Every URL the page asks for from now on. */
function urlsAsked(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => {
    urls.push(request.url());
  });
  return urls;
}

/** A search of the team's lists as the API takes it: a POST with what was typed in its body. */
async function searchAsked(page: Page, list: 'appointments' | 'patients', query: string) {
  return page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname.endsWith(`/desk/${list}/search`) &&
      (request.postDataJSON() as { query?: string }).query === query,
  );
}

/** A staff account as the operator's command leaves it: a place, and maybe a second factor. */
async function staffAccount(
  testInfo: TestInfo,
  {
    role,
    secondFactor,
    provider,
  }: { readonly role?: Role; readonly secondFactor?: boolean; readonly provider?: string },
): Promise<string> {
  const { project, repeatEachIndex, retry, testId } = testInfo;
  const email = `${project.name}-${testId}-${String(repeatEachIndex)}-${String(retry)}@example.test`;
  const query = `email=${encodeURIComponent(email)}`;
  await fetch(`${STUB}/api/v1/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD, locale: localeOf(testInfo) }),
  });
  const link = provider === undefined ? '' : `&provider=${provider}`;
  if (role !== undefined) await fetch(`${STUB}/__staff?${query}&${PLACES[role]}${link}`);
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

/** A member of the team, signed in with both factors, on the day of the practice. */
async function onTheDay(
  page: Page,
  testInfo: TestInfo,
  role: Role = 'STAFF',
  provider?: string,
): Promise<Locale> {
  const locale = localeOf(testInfo);
  await signInFromDashboard(
    page,
    locale,
    await staffAccount(testInfo, {
      role,
      secondFactor: true,
      ...(provider === undefined ? {} : { provider }),
    }),
  );
  await page.getByLabel(texts(locale).signIn.codeLabel, { exact: true }).fill(STUB_CODE);
  await page.getByRole('button', { name: texts(locale).signIn.verify }).click();
  await expect(page).toHaveURL(`/${locale}/dashboard`);
  await expect(page.getByRole('table')).toBeVisible();
  return locale;
}

test.describe('the practice dashboard (08 A04)', () => {
  test('sets up two-step sign-in with the QR code, then shows the role', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const t = texts(locale).twoFactor;
    await signInFromDashboard(page, locale, await staffAccount(testInfo, { role: 'MANAGER' }));
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
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('complementary')).toContainText(
      selected(desk(locale).shell.role, 'STAFF'),
    );
    await expect(page.getByRole('complementary')).toContainText(desk(locale).shell.management);
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
    await expect(page.getByRole('complementary')).toContainText(
      selected(desk(locale).shell.role, 'STAFF'),
    );
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
    await expect(page.getByRole('table')).toHaveCount(0);
  });
});

test.describe('the day of the practice (08 M05)', () => {
  test('shows the day with its figures and checks a patient in', async ({ page }, testInfo) => {
    const locale = await onTheDay(page, testInfo);
    const d = desk(locale);
    const figures = page.getByRole('region', { name: d.today.figures });
    await expect(figures.getByRole('listitem')).toHaveCount(4);
    await expect(figures).toContainText(d.today.openTimes);
    // A header row and the five appointments of the stub's today.
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(6);
    await expectAccessibleAtBothWidths(page, 'the day');
    // A long address is cut, and nothing of the column reaches into the page (1440 px of Figma).
    await page.setViewportSize({ width: 1440, height: 1000 });
    const column = await page.getByRole('complementary').boundingBox();
    const signOut = await page
      .getByRole('button', { name: texts(locale).account.signOut })
      .boundingBox();
    expect(column).not.toBeNull();
    expect(signOut).not.toBeNull();
    if (column !== null && signOut !== null) {
      expect(signOut.x).toBeGreaterThanOrEqual(column.x);
      expect(signOut.x + signOut.width).toBeLessThanOrEqual(column.x + column.width);
    }

    const row = page.getByRole('row', { name: /Omar Beispiel/ });
    await expect(row).toContainText(selected(d.status, 'BOOKED'));
    await row
      .getByRole('button', { name: new RegExp(`${d.today.checkIn}.*Omar Beispiel`) })
      .click();
    await expect(row).toContainText(selected(d.status, 'CHECKED_IN'));
    const news = page.getByRole('main').getByRole('status');
    await expect(news).toContainText('Omar Beispiel');
    await expect(news).toBeFocused();
    // A completed and a cancelled appointment offer nothing but their details.
    const done = page.getByRole('row', { name: /Sami Beispiel/ });
    await expect(done.getByRole('button')).toHaveCount(1);
  });

  test('opens an appointment with the patient’s note, and cancels it with a reason', async ({
    page,
  }, testInfo) => {
    const locale = await onTheDay(page, testInfo, 'DOCTOR');
    const d = desk(locale);
    await page.getByRole('button', { name: new RegExp(`${d.today.details}.*سارة مثال`) }).click();
    const sheet = page.getByRole('dialog').filter({ hasText: d.details.kicker });
    await expect(sheet).toContainText(NOTE);
    await expect(sheet).toContainText(d.details.noteLabel);
    await expect(sheet).toContainText(d.details.audited);
    await expectAccessibleAtBothWidths(page, 'the details');

    await sheet.getByRole('button', { name: d.details.cancel }).click();
    const dialog = page.getByRole('dialog', { name: d.cancel.title });
    await expect(dialog).toContainText(d.cancel.reasonHint);
    await dialog.getByRole('button', { name: d.cancel.confirm }).click();
    await expect(dialog).toContainText(d.cancel.required);
    await expectAccessibleAtBothWidths(page, 'the cancel dialog');
    await dialog
      .getByLabel(d.cancel.reason, { exact: true })
      .fill('Synthetic reason: the doctor is ill.');
    await dialog.getByRole('button', { name: d.cancel.confirm }).click();
    await expect(dialog).toBeHidden();
    await expect(sheet).toContainText(selected(d.status, 'CANCELLED'));
    await expect(sheet).toContainText('Synthetic reason: the doctor is ill.');
    await sheet.getByRole('button', { name: d.details.close }).click();
    await expect(page.getByRole('row', { name: /سارة مثال/ })).toContainText(
      selected(d.status, 'CANCELLED'),
    );
  });

  test('records a no-show from the start, and offers no check-in on another day', async ({
    page,
  }, testInfo) => {
    const locale = await onTheDay(page, testInfo);
    const d = desk(locale);
    await page.getByRole('button', { name: new RegExp(`${d.today.details}.*سارة مثال`) }).click();
    const sheet = page.getByRole('dialog').filter({ hasText: d.details.kicker });
    await sheet.getByRole('button', { name: d.details.noShow }).click();
    await expect(sheet).toContainText(selected(d.status, 'NO_SHOW'));
    // The button went with the change: the focus is on what it did, inside the drawer.
    await expect(sheet.getByRole('status')).toBeFocused();
    await expect(sheet.getByRole('button', { name: d.details.checkIn })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    await page.getByRole('button', { name: d.today.next }).click();
    await expect(page.getByRole('heading', { level: 1, name: d.today.otherDay })).toBeVisible();
    const tomorrow = page.getByRole('row', { name: /Huda Example/ });
    await expect(tomorrow.getByRole('button')).toHaveCount(1);
    await tomorrow.getByRole('button', { name: new RegExp(d.today.details) }).click();
    await expect(page.getByRole('dialog').filter({ hasText: d.details.kicker })).toContainText(
      d.details.hintFuture,
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: d.today.today, exact: true }).click();
    await expect(page.getByRole('row', { name: /Omar Beispiel/ })).toBeVisible();
  });

  test('signs out after 15 minutes without activity, after a warning', async ({
    page,
  }, testInfo) => {
    await page.clock.install();
    const locale = await onTheDay(page, testInfo);
    const d = desk(locale);
    await page.clock.fastForward('14:01');
    const warning = page.getByRole('alertdialog', { name: d.idle.title });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: d.idle.stay }).click();
    await expect(warning).toBeHidden();
    await page.clock.fastForward('15:01');
    await expect(page).toHaveURL(
      `/${locale}/sign-in#next=${encodeURIComponent(`/${locale}/dashboard`)}`,
    );
  });
});

test.describe('the team’s lists (08 M05)', () => {
  test('lists the week, found by a patient with tashkeel and narrowed by status', async ({
    page,
  }, testInfo) => {
    const locale = await onTheDay(page, testInfo);
    const d = desk(locale);
    await page
      .getByRole('navigation', { name: d.shell.nav })
      .getByRole('link', { name: d.shell.appointments })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: d.appointments.title })).toBeVisible();
    const table = page.getByRole('table');
    // A header row, a heading for today and tomorrow, and the six appointments of the stub's week.
    await expect(table.getByRole('row')).toHaveCount(9);
    await expect(page.getByRole('navigation', { name: d.pager.label })).toContainText('6');
    await expectAccessibleAtBothWidths(page, 'the appointments');

    const urls = urlsAsked(page);
    const search = page.getByLabel(d.appointments.search, { exact: true });
    const asked = searchAsked(page, 'appointments', 'سَارَة');
    await search.fill('سَارَة');
    await asked;
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table.getByRole('row', { name: /سارة مثال/ })).toBeVisible();
    expect(urls.filter((url) => decodeURIComponent(url).includes('سَارَة'))).toEqual([]);
    await search.fill('');
    await page.getByRole('button', { name: new RegExp(d.appointments.allStatuses) }).click();
    await page.getByRole('option', { name: selected(d.status, 'CANCELLED') }).click();
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table.getByRole('row', { name: /Yusuf Example/ })).toBeVisible();
  });

  test('finds a patient with and without tashkeel, and opens the record', async ({
    page,
  }, testInfo) => {
    const locale = await onTheDay(page, testInfo);
    const d = desk(locale);
    await page.getByRole('link', { name: d.shell.patients }).click();
    await expect(page.getByRole('heading', { level: 1, name: d.patients.title })).toBeVisible();
    const table = page.getByRole('table');
    const pager = page.getByRole('navigation', { name: d.pager.label });
    // The six patients of the week and nineteen without an appointment: a first page of twenty.
    await expect(table.getByRole('row')).toHaveCount(21);
    await expect(pager).toContainText(showing(d.pager.showing, 1, 20, 25));
    await expectAccessibleAtBothWidths(page, 'the patients');
    // The API counts on the first page only; the second keeps that count.
    await pager.getByRole('button', { name: d.pager.next }).click();
    await expect(table.getByRole('row')).toHaveCount(6);
    await expect(pager).toContainText(showing(d.pager.showing, 21, 25, 25));
    await expect(pager).toContainText(d.pager.page.replace('{page}', '2').replace('{pages}', '2'));
    await pager.getByRole('button', { name: d.pager.previous }).click();
    await expect(table.getByRole('row')).toHaveCount(21);

    const urls = urlsAsked(page);
    for (const query of ['سارة', 'سَارَة', 'ساره']) {
      const asked = searchAsked(page, 'patients', query);
      await page.getByLabel(d.patients.search, { exact: true }).fill(query);
      await asked;
      await expect(table.getByRole('row')).toHaveCount(2);
      await expect(table).toContainText('سارة');
    }
    // What was typed went in the bodies of the searches, never in a URL (health-data-security).
    expect(
      urls.filter((url) =>
        ['سارة', 'سَارَة', 'ساره'].some((query) => decodeURIComponent(url).includes(query)),
      ),
    ).toEqual([]);
    await table.getByRole('button', { name: /سارة مثال/ }).click();
    const record = page.getByRole('dialog').filter({ hasText: d.patients.kicker });
    await expect(record).toContainText(d.patients.nothingUpcoming);
    await expect(record).toContainText(d.patients.audited);
    await expectAccessibleAtBothWidths(page, 'the record');
    await record.getByRole('button', { name: new RegExp(d.today.details) }).click();
    await expect(page.getByRole('dialog').filter({ hasText: d.details.kicker })).toContainText(
      NOTE,
    );
  });
});

test.describe('booking for a patient (08 M05, W7)', () => {
  test('books for a patient found by name, and the week shows it', async ({ page }, testInfo) => {
    const locale = await onTheDay(page, testInfo);
    const d = desk(locale);
    await page.getByRole('link', { name: d.shell.appointments }).click();
    const table = page.getByRole('table');
    await expect(table.getByRole('row')).toHaveCount(9);
    // A change from the list reads the list again, also when it is a search (a POST).
    const omar = table.getByRole('row', { name: /Omar Beispiel/ });
    await omar
      .getByRole('button', { name: new RegExp(`${d.today.checkIn}.*Omar Beispiel`) })
      .click();
    await expect(omar).toContainText(selected(d.status, 'CHECKED_IN'));

    const urls = urlsAsked(page);
    await page.getByRole('button', { name: d.book.open }).click();
    const dialog = page.getByRole('dialog', { name: d.book.title });
    await dialog.getByLabel(d.book.search, { exact: true }).fill('ساره');
    await dialog.getByRole('button', { name: /سارة مثال/ }).click();
    await expect(dialog.getByRole('button', { name: d.book.change })).toBeVisible();
    await dialog.getByRole('button', { name: new RegExp(d.book.chooseService) }).click();
    await page
      .getByRole('option', { name: new RegExp(locale === 'ar' ? 'فحص عام' : 'Check-up') })
      .click();
    await dialog
      .getByRole('radiogroup', { name: d.book.days })
      .getByRole('radio', { disabled: false })
      .first()
      .click();
    await dialog.getByRole('radio', { name: /12:00/ }).click();
    await expect(dialog).toContainText(locale === 'ar' ? 'فحص عام' : 'Check-up');
    await expectAccessibleAtBothWidths(page, 'the booking for a patient');
    await dialog.getByRole('button', { name: d.book.confirm }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('main').getByRole('status')).toContainText('سارة مثال');
    await expect(table.getByRole('row', { name: /سارة مثال/ })).toHaveCount(2);
    expect(urls.filter((url) => decodeURIComponent(url).includes('ساره'))).toEqual([]);
  });

  test('adds a patient without an account, with what the practice asks, and books for them', async ({
    page,
  }, testInfo) => {
    const locale = await onTheDay(page, testInfo);
    const d = desk(locale);
    const details = texts(locale).details;
    await page.getByRole('link', { name: d.shell.appointments }).click();
    await page.getByRole('button', { name: d.book.open }).click();
    const dialog = page.getByRole('dialog', { name: d.book.title });
    await dialog.getByRole('button', { name: d.book.newPatient }).click();
    const form = dialog.getByRole('group', { name: d.book.newPatientTitle });
    await form.getByRole('button', { name: d.book.addPatient }).click();
    await expect(form.getByText(d.book.required).first()).toBeVisible();
    // A person the practice may know already: the team is asked to look first.
    await form.getByLabel(details.firstName).fill('Sami');
    await form.getByLabel(details.lastName).fill('Beispiel');
    await form.getByLabel(details.dateOfBirth).fill('1990-04-12');
    await form.getByRole('button', { name: new RegExp(details.insuranceType) }).click();
    await page.getByRole('option', { name: details.SELF_PAY }).click();
    await form.getByRole('button', { name: d.book.addPatient }).click();
    await expect(form.getByRole('alert')).toContainText(d.book.errors.PATIENT_MAY_EXIST);
    await expect(form.getByRole('button', { name: d.book.addAnyway })).toBeVisible();
    // Other details are another person: the question goes, and so does "add anyway".
    await form.getByLabel(details.firstName).fill('Lina');
    await form.getByLabel(details.dateOfBirth).fill('1985-02-03');
    await expect(form.getByRole('button', { name: d.book.addAnyway })).toHaveCount(0);
    await form.getByRole('button', { name: d.book.addPatient }).click();
    await expect(dialog.getByRole('button', { name: d.book.change })).toBeVisible();
    await expect(dialog).toContainText('Lina Beispiel');
    await dialog.getByRole('button', { name: new RegExp(d.book.chooseService) }).click();
    await page
      .getByRole('option', { name: new RegExp(locale === 'ar' ? 'تحليل دم' : 'Blood test') })
      .click();
    await dialog
      .getByRole('radiogroup', { name: d.book.days })
      .getByRole('radio', { disabled: false })
      .first()
      .click();
    await dialog.getByRole('radio', { name: /12:30/ }).click();
    await dialog.getByRole('button', { name: d.book.confirm }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('table').getByRole('row', { name: /Lina Beispiel/ })).toBeVisible();
    // The patient the team added is one of the practice's patients now.
    await page.getByRole('link', { name: d.shell.patients }).click();
    await page.getByLabel(d.patients.search, { exact: true }).fill('Lina');
    await expect(page.getByRole('table')).toContainText('Lina Beispiel');
  });

  test('books from a patient’s record, for that patient', async ({ page }, testInfo) => {
    const locale = await onTheDay(page, testInfo);
    const d = desk(locale);
    await page.getByRole('link', { name: d.shell.patients }).click();
    await page.getByLabel(d.patients.search, { exact: true }).fill('سارة');
    await page
      .getByRole('table')
      .getByRole('button', { name: /سارة مثال/ })
      .click();
    const record = page.getByRole('dialog').filter({ hasText: d.patients.kicker });
    await record.getByRole('button', { name: d.book.openFor }).click();
    const dialog = page.getByRole('dialog', { name: d.book.title });
    await expect(dialog.getByLabel(d.book.search, { exact: true })).toHaveCount(0);
    await expect(dialog).toContainText('سارة مثال');
    await dialog.getByRole('button', { name: new RegExp(d.book.chooseService) }).click();
    await page
      .getByRole('option', { name: new RegExp(locale === 'ar' ? 'فحص عام' : 'Check-up') })
      .click();
    await dialog
      .getByRole('radiogroup', { name: d.book.days })
      .getByRole('radio', { disabled: false })
      .first()
      .click();
    await dialog.getByRole('radio', { name: /13:00/ }).click();
    await dialog.getByRole('button', { name: d.book.confirm }).click();
    await expect(dialog).toBeHidden();
    await expect(record.getByRole('status')).toContainText('سارة مثال');
  });
});

test.describe('the team’s care for its patients (08 M04 part 3)', () => {
  /** The record of a patient of the stub's day, found in W8. */
  async function openRecord(page: Page, locale: Locale, name: string) {
    const d = desk(locale);
    await page.getByRole('link', { name: d.shell.patients }).click();
    await page.getByLabel(d.patients.search, { exact: true }).fill(name.split(' ')[0] ?? name);
    await page
      .getByRole('table')
      .getByRole('button', { name: new RegExp(name) })
      .click();
    return page.getByRole('dialog').filter({ hasText: d.patients.kicker });
  }

  test('books past the limit of upcoming appointments only with a reason (BR-02)', async ({
    page,
  }, testInfo) => {
    const locale = await onTheDay(page, testInfo);
    const d = desk(locale);
    const record = await openRecord(page, locale, 'Omar Beispiel');
    // Only practice management hands out a patient's copy.
    await expect(record.getByRole('button', { name: d.patients.export })).toHaveCount(0);
    const bookAt = async (time: RegExp) => {
      await record.getByRole('button', { name: d.book.openFor }).click();
      const dialog = page.getByRole('dialog', { name: d.book.title });
      await dialog.getByRole('button', { name: new RegExp(d.book.chooseService) }).click();
      await page
        .getByRole('option', { name: new RegExp(locale === 'ar' ? 'فحص عام' : 'Check-up') })
        .click();
      await dialog
        .getByRole('radiogroup', { name: d.book.days })
        .getByRole('radio', { disabled: false })
        .first()
        .click();
      await dialog.getByRole('radio', { name: time }).click();
      await dialog.getByRole('button', { name: d.book.confirm }).click();
      return dialog;
    };
    // Omar has one appointment to come: a second one is within the stub practice's limit of two.
    await expect(await bookAt(/12:00/)).toBeHidden();
    const third = await bookAt(/12:30/);
    await expect(third.getByRole('alert')).toContainText(
      d.book.errors.BOOKING_LIMIT_REACHED.replace(/\s*\(\{maxFutureAppointments\}\).*$/u, ''),
    );
    await expect(third).toContainText(d.book.overrideHint);
    await third.getByRole('button', { name: d.book.bookAnyway }).click();
    await expect(third).toContainText(d.book.required);
    await third
      .getByLabel(d.book.overrideReason, { exact: true })
      .fill('Synthetic reason: a follow-up the doctor asked for.');
    await third.getByRole('button', { name: d.book.bookAnyway }).click();
    await expect(third).toBeHidden();
    await expect(record.getByRole('status')).toContainText('Omar Beispiel');
  });

  test('lets the team correct a patient the practice keeps, and management export the copy', async ({
    page,
  }, testInfo) => {
    const locale = await onTheDay(page, testInfo, 'MANAGER');
    const d = desk(locale);
    const details = texts(locale).details;
    const record = await openRecord(page, locale, 'Omar Beispiel');
    await record.getByRole('button', { name: d.patients.edit }).click();
    const form = record.getByRole('form', { name: d.patients.editTitle });
    await expect(form.getByLabel(details.lastName)).toHaveValue('Beispiel');
    await form.getByLabel(details.lastName).fill('');
    await form.getByRole('button', { name: d.patients.save }).click();
    await expect(form).toContainText(d.book.required);
    await form.getByLabel(details.lastName).fill('Beispielmann');
    await form.getByRole('button', { name: d.patients.save }).click();
    await expect(form).toBeHidden();
    await expect(record.getByRole('status')).toContainText(d.patients.saved);
    await expect(record.getByRole('heading', { name: /Omar Beispielmann/ })).toBeVisible();
    // The person's copy (GDPR Art. 15): a file for practice management, who checks it first.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      record.getByRole('button', { name: d.patients.export }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^patient-[0-9a-f-]+\.json$/u);
    await expect(record.getByRole('status')).toContainText(d.patients.exported);
  });

  test('offers no correction of a profile its person keeps through an account', async ({
    page,
  }, testInfo) => {
    const locale = await onTheDay(page, testInfo);
    const d = desk(locale);
    const record = await openRecord(page, locale, 'سارة مثال');
    await expect(record.getByRole('button', { name: d.book.openFor })).toBeVisible();
    await expect(record.getByRole('button', { name: d.patients.edit })).toHaveCount(0);
  });
});

test.describe('the calendar (08 M05, W2)', () => {
  test('shows a doctor’s week with booked, free and blocked times, and opens an appointment', async ({
    page,
  }, testInfo) => {
    const locale = await onTheDay(page, testInfo);
    const d = desk(locale);
    await page
      .getByRole('navigation', { name: d.shell.nav })
      .getByRole('link', { name: d.shell.calendar })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: d.calendar.title })).toBeVisible();
    const grid = page.getByRole('table');
    // The time column, Sunday and Monday with their times, and Tuesday with its training.
    await expect(grid.getByRole('columnheader')).toHaveCount(4);
    await expect(grid).toContainText(d.calendar.availableFor.replace('{minutes}', '30'));
    const away = `${d.calendar.absence.split('{')[0] ?? ''}${selected(d.calendar.absence, 'TRAINING')}`;
    await expect(grid.getByText(away).first()).toBeVisible();
    await expectAccessibleAtBothWidths(page, 'the calendar');

    await grid.getByRole('button', { name: /Omar Beispiel/ }).click();
    const details = page.getByRole('dialog').filter({ hasText: d.details.kicker });
    await expect(details).toContainText('Omar Beispiel');
    await page.keyboard.press('Escape');
    await expect(details).toBeHidden();

    await page.getByRole('button', { name: d.calendar.nextWeek }).click();
    await expect(page.getByRole('main')).toContainText(d.calendar.empty);
    await page.getByRole('button', { name: d.calendar.thisWeek }).click();
    await expect(grid.getByRole('button', { name: /Omar Beispiel/ })).toBeVisible();
  });
});

/** The name of an ISO weekday as the dashboard writes it. */
function weekdayName(locale: Locale, isoWeekday: number): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, isoWeekday)),
  );
}

/** The name of a language in itself, as the tabs of W13 name it. */
function languageName(code: Locale): string {
  return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
}

test.describe('what the team sets up (08 M02, W12, W13, W20)', () => {
  test('lets practice management add a service, take it offline and archive it', async ({
    page,
  }, testInfo) => {
    const locale = await onTheDay(page, testInfo, 'MANAGER');
    const d = desk(locale);
    await page
      .getByRole('navigation', { name: d.shell.nav })
      .getByRole('link', { name: d.shell.services })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: d.services.title })).toBeVisible();
    const table = page.getByRole('table');
    await expect(table.getByRole('rowheader', { name: /Check-up|فحص عام/ })).toBeVisible();
    await expectAccessibleAtBothWidths(page, 'the services');

    await page.getByRole('button', { name: d.services.add }).click();
    const form = page.getByRole('dialog', { name: d.serviceForm.addTitle });
    await form.getByRole('button', { name: d.serviceForm.create }).click();
    await expect(form.getByText(d.serviceForm.nameMissing)).toBeVisible();
    const names = { ar: 'تخطيط القلب', en: 'ECG' } as const;
    for (const code of ['en', 'ar'] as const) {
      await form.getByRole('tab', { name: languageName(code) }).click();
      await form.getByLabel(d.serviceForm.name, { exact: true }).fill(names[code]);
    }
    // Ten minutes kept free after it (BR-27), and patients bring a referral (BR-26).
    await form.getByRole('button', { name: new RegExp(d.serviceForm.buffer) }).click();
    await page
      .getByRole('option', { name: d.services.minutes.replace('{minutes}', '10'), exact: true })
      .click();
    await form.getByText(d.serviceForm.referral, { exact: true }).click();
    await expectAccessibleAtBothWidths(page, 'the service form');
    await form.getByRole('button', { name: d.serviceForm.create }).click();
    await expect(form).toBeHidden();
    await expect(page.getByRole('status')).toContainText(names[locale]);

    const row = table.getByRole('row').filter({ hasText: names[locale] });
    await expect(row).toContainText(d.services.referral);
    await row.getByRole('button', { name: d.services.edit }).click();
    const saved = page.getByRole('dialog', { name: d.serviceForm.editTitle });
    await expect(
      saved.getByRole('button', { name: new RegExp(d.serviceForm.buffer) }),
    ).toContainText(d.services.minutes.replace('{minutes}', '10'));
    await saved.getByRole('button', { name: d.serviceForm.cancel }).click();
    await row.getByText(d.services.onlineOn, { exact: true }).click();
    await expect(row).toContainText(d.services.onlineOff);
    await row.getByRole('button', { name: d.services.edit }).click();
    const edit = page.getByRole('dialog', { name: d.serviceForm.editTitle });
    await edit.getByRole('button', { name: d.serviceForm.archive }).click();
    await expect(edit).toBeHidden();
    await expect(row).toContainText(d.services.archived);
    await expect(row.getByRole('switch')).toBeDisabled();
  });

  test('tells patients on the practice page which service needs a referral', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    await page.goto(`/${locale}`);
    const services = page.locator('#services');
    await expect(services.getByRole('listitem').filter({ hasText: 'Vaccination' })).toContainText(
      messages[locale].practicePage.services.referral,
    );
    await expect(services.getByRole('listitem').filter({ hasText: 'Check-up' })).not.toContainText(
      messages[locale].practicePage.services.referral,
    );
  });

  test('lets the reception change the opening hours and the special days, not the services', async ({
    page,
  }, testInfo) => {
    const locale = await onTheDay(page, testInfo);
    const d = desk(locale);
    const nav = page.getByRole('navigation', { name: d.shell.nav });
    await nav.getByRole('link', { name: d.shell.services }).click();
    await expect(page.getByText(d.services.readOnly)).toBeVisible();
    await expect(page.getByRole('button', { name: d.services.add })).toHaveCount(0);

    await nav.getByRole('link', { name: d.shell.settings }).click();
    await expect(page.getByRole('heading', { level: 1, name: d.settings.title })).toBeVisible();
    const hours = page.getByRole('region', { name: d.settings.hoursTitle });
    await expect(hours).toContainText(d.settings.closed);
    await expectAccessibleAtBothWidths(page, 'the settings');

    await hours.getByRole('button', { name: d.settings.editHours }).click();
    const editor = page.getByRole('dialog', { name: d.hoursForm.title });
    const monday = editor.getByRole('group', { name: weekdayName(locale, 1) });
    await monday.getByRole('button', { name: d.hoursForm.addHours }).click();
    await monday.getByLabel(d.hoursForm.opens).nth(1).fill('15:00');
    await editor.getByRole('button', { name: d.hoursForm.save }).click();
    await expect(monday.getByRole('alert')).toHaveText(d.hoursForm.overlaps);
    await expectAccessibleAtBothWidths(page, 'the hours editor with an overlap');
    await monday.getByLabel(d.hoursForm.opens).nth(1).fill('16:30');
    await editor.getByRole('button', { name: d.hoursForm.save }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByRole('status')).toHaveText(d.settings.savedHours);
    await expect(hours).toContainText(weekdayName(locale, 1));

    const special = page.getByRole('region', { name: d.settings.specialTitle });
    const add = async (): Promise<void> => {
      await special.getByRole('button', { name: d.settings.addSpecial }).click();
      const form = page.getByRole('dialog', { name: d.specialForm.title });
      await form.getByLabel(d.specialForm.date, { exact: true }).fill('2026-11-19');
      await form
        .getByLabel(d.specialForm.label.replace('{language}', languageName('en')))
        .fill('Team training');
      await form.getByRole('button', { name: d.specialForm.save }).click();
    };
    await add();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(special).toContainText('Team training');
    await add();
    const again = page.getByRole('dialog', { name: d.specialForm.title });
    await expect(again.getByText(d.specialForm.dateTaken)).toBeVisible();
    await again.getByRole('button', { name: d.specialForm.cancel }).click();
    await special.getByRole('button', { name: new RegExp(d.settings.remove) }).click();
    await expect(special).toContainText(d.settings.noSpecial);
    // The news comes although the removed day's row leaves the list with the refetch.
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: d.settings.removedSpecial.replace(/\{date\}.*$/u, '').trim() }),
    ).toBeVisible();
  });
});

/** The stub's doctor (desk-stub.ts). */
const STUB_DOCTOR_ID = '70000000-0000-4000-8000-000000000001';

test.describe('the doctors’ schedules (08 M04, W14, W2)', () => {
  test('lets the reception plan a doctor’s week, its exceptions and its free times', async ({
    page,
  }, testInfo) => {
    const locale = await onTheDay(page, testInfo);
    const d = desk(locale);
    await page
      .getByRole('navigation', { name: d.shell.nav })
      .getByRole('link', { name: d.shell.calendar })
      .click();
    await page.getByRole('link', { name: d.calendar.workingHours }).click();
    await expect(page.getByRole('heading', { level: 1, name: d.workingHours.title })).toBeVisible();
    await expect(page.getByText('Dr. Lina Example')).toBeVisible();
    await expectAccessibleAtBothWidths(page, 'the working hours');

    // Friday on, then hours on Sunday that overlap its morning: the API names them.
    await page.getByText(weekdayName(locale, 5), { exact: true }).click();
    const sunday = page.getByRole('group', { name: weekdayName(locale, 7) });
    await sunday.getByRole('button', { name: d.workingHours.addHours }).click();
    await sunday.getByLabel(d.workingHours.from).last().fill('11:00');
    await sunday.getByLabel(d.workingHours.to).last().fill('14:00');
    await page.getByRole('button', { name: d.workingHours.save }).click();
    await expect(sunday.getByRole('alert')).toHaveText(d.workingHours.overlaps);
    await sunday.getByRole('button', { name: d.workingHours.removeHours }).last().click();
    await page.getByRole('button', { name: d.workingHours.save }).click();
    await expect(page.getByRole('status').first()).toContainText('Dr. Lina Example');

    // An exception of a whole day, and away again.
    await page.getByRole('button', { name: d.workingHours.addAbsence }).click();
    const form = page.getByRole('dialog', { name: d.absenceForm.title });
    await form.getByLabel(d.absenceForm.from, { exact: true }).fill('2026-11-19');
    await form.getByLabel(d.absenceForm.to, { exact: true }).fill('2026-11-19');
    await expectAccessibleAtBothWidths(page, 'the exception form');
    await form.getByRole('button', { name: d.absenceForm.save }).click();
    await expect(form).toBeHidden();
    await expect(page.getByRole('status').first()).toHaveText(d.workingHours.absenceAdded);
    const exceptions = page.getByRole('region', { name: d.workingHours.absencesTitle });
    await exceptions.getByRole('button', { name: new RegExp(d.workingHours.remove) }).click();
    await expect(exceptions).toContainText(d.workingHours.noAbsences);
    await expect(
      page.getByRole('status').filter({ hasText: d.workingHours.absenceRemoved }),
    ).toBeVisible();

    await page.getByRole('button', { name: d.workingHours.generate }).click();
    await expect(page.getByRole('status').first()).toContainText('12');
  });

  test('blocks a free time in the calendar and frees it again', async ({ page }, testInfo) => {
    const locale = await onTheDay(page, testInfo);
    const d = desk(locale);
    await page
      .getByRole('navigation', { name: d.shell.nav })
      .getByRole('link', { name: d.shell.calendar })
      .click();
    const grid = page.getByRole('table');
    const free = grid
      .getByRole('button', { name: d.calendar.availableFor.replace('{minutes}', '30') })
      .last();
    await free.click();
    const block = page.getByRole('dialog', { name: d.calendar.blockTitle });
    await expectAccessibleAtBothWidths(page, 'blocking a time');
    await block.getByRole('button', { name: d.calendar.block, exact: true }).click();
    await expect(block).toBeHidden();
    const blocked = grid.getByRole('button', { name: new RegExp(d.calendar.blocked) }).last();
    await expect(blocked).toBeVisible();
    await blocked.click();
    const unblock = page.getByRole('dialog', { name: d.calendar.unblockTitle });
    await unblock.getByRole('button', { name: d.calendar.unblock }).click();
    await expect(unblock).toBeHidden();
    await expect(grid.getByRole('button', { name: new RegExp(d.calendar.blocked) })).toHaveCount(0);
  });

  test('lets a doctor plan only itself, and only once its account names it', async ({
    page,
  }, testInfo) => {
    const locale = await onTheDay(page, testInfo, 'DOCTOR', STUB_DOCTOR_ID);
    const d = desk(locale);
    await page.goto(`/${locale}/dashboard/calendar/working-hours`);
    await expect(page.getByText('Dr. Lina Example')).toBeVisible();
    await expect(page.getByRole('button', { name: d.workingHours.save })).toBeVisible();
    // The practice's free times are the reception's to make.
    await expect(page.getByRole('button', { name: d.workingHours.generate })).toHaveCount(0);
  });

  test('lets a doctor with practice management plan every doctor', async ({ page }, testInfo) => {
    const locale = await onTheDay(page, testInfo, 'MANAGING_DOCTOR', STUB_DOCTOR_ID);
    const d = desk(locale);
    await page.goto(`/${locale}/dashboard/calendar/working-hours`);
    await expect(page.getByRole('button', { name: d.workingHours.generate })).toBeVisible();
  });

  test('tells a doctor whose account names no doctor yet', async ({ page }, testInfo) => {
    const locale = await onTheDay(page, testInfo, 'DOCTOR');
    const d = desk(locale);
    await page.goto(`/${locale}/dashboard/calendar/working-hours`);
    await expect(page.getByText(d.workingHours.notLinked)).toBeVisible();
  });
});

test.describe('the team (08 M03, W15)', () => {
  test('lets practice management see the team by place and change a role', async ({
    page,
  }, testInfo) => {
    const locale = await onTheDay(page, testInfo, 'MANAGER');
    const d = desk(locale);
    await page
      .getByRole('navigation', { name: d.shell.nav })
      .getByRole('link', { name: d.shell.team, exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: d.team.title })).toBeVisible();
    const people = page.getByRole('table').getByRole('rowheader');
    await expect(people).toHaveCount(4);
    await expectAccessibleAtBothWidths(page, 'the team');

    // The views by place: the doctors, and the deactivated on their own.
    const view = (filter: string) =>
      page.getByRole('tab', { name: new RegExp(selected(d.team.filter, filter)) });
    await view('DOCTORS').click();
    await expect(people).toHaveText([/Lina Example/]);
    await view('INACTIVE').click();
    await expect(people).toHaveText([/Nadia Example/]);
    await view('other').click();
    await expect(people).toHaveCount(4);

    // The last person with practice management keeps it, and cannot lock itself out.
    const you = page.getByRole('row').filter({ hasText: d.team.you });
    await expect(you.getByRole('button', { name: d.team.deactivate })).toHaveCount(0);
    await you.getByRole('button', { name: d.team.changeRole }).click();
    const own = page.getByRole('dialog', { name: d.roleForm.title });
    await own.getByText(d.roleForm.management, { exact: true }).click();
    await own.getByRole('button', { name: d.roleForm.save }).click();
    await expect(own.getByRole('alert')).toHaveText(messages[locale].errors.LAST_PRACTICE_MANAGER);
    await own.getByRole('button', { name: d.roleForm.cancel }).click();
    await expect(own).toBeHidden();

    // Sara of the practice team becomes the doctor no account is yet, with practice management.
    const sara = page.getByRole('row').filter({ hasText: 'Sara Example' });
    await sara.getByRole('button', { name: d.team.changeRole }).click();
    const form = page.getByRole('dialog', { name: d.roleForm.title });
    await form.getByText(d.roleForm.doctor, { exact: true }).click();
    await form.getByRole('button', { name: new RegExp(d.roleForm.doctorLink) }).click();
    // Another account is Lina already: one account per doctor.
    await expect(page.getByRole('option', { name: /Dr\. Lina Example/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.getByRole('option', { name: 'Dr. Omar Example' }).click();
    await form.getByText(d.roleForm.management, { exact: true }).click();
    await expectAccessibleAtBothWidths(page, 'the role form');
    await form.getByRole('button', { name: d.roleForm.save }).click();
    await expect(form).toBeHidden();
    await expect(page.getByRole('status')).toContainText('Sara Example');
    await expect(sara).toContainText(selected(d.shell.role, 'DOCTOR'));
    await expect(sara).toContainText(d.shell.management);
    await expect(sara).toContainText('Dr. Omar Example');
  });

  test('resets a lost authenticator app, deactivates a member and gives the access back', async ({
    page,
  }, testInfo) => {
    const locale = await onTheDay(page, testInfo, 'MANAGER');
    const d = desk(locale);
    await page.goto(`/${locale}/dashboard/team`);
    const lina = page.getByRole('row').filter({ hasText: 'Lina Example' });
    const dialog = page.getByRole('dialog');

    await lina.getByRole('button', { name: d.team.resetSecondFactor }).click();
    await expect(dialog).toContainText('Lina Example');
    await expectAccessibleAtBothWidths(page, 'resetting an authenticator app');
    await dialog.getByRole('button', { name: d.team.resetSecondFactor }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status')).toContainText('Lina Example');
    await expect(lina).toContainText(d.team.secondFactorOff);

    await lina.getByRole('button', { name: d.team.deactivate }).click();
    await dialog.getByRole('button', { name: d.team.deactivate }).click();
    await expect(dialog).toBeHidden();
    await expect(lina).toContainText(d.team.inactive);
    // The doctor's link goes with the access.
    await expect(lina).toContainText(d.team.notLinked);

    await lina.getByRole('button', { name: d.team.reactivate }).click();
    await dialog.getByRole('button', { name: d.team.reactivate }).click();
    await expect(dialog).toBeHidden();
    await expect(lina).toContainText(d.team.active);
    await expect(lina.getByRole('button', { name: d.team.changeRole })).toBeVisible();
  });

  test('keeps the team to practice management', async ({ page }, testInfo) => {
    const locale = await onTheDay(page, testInfo);
    const d = desk(locale);
    await expect(
      page
        .getByRole('navigation', { name: d.shell.nav })
        .getByRole('link', { name: d.shell.team, exact: true }),
    ).toHaveCount(0);
    await page.goto(`/${locale}/dashboard/team`);
    await expect(page.getByText(d.team.onlyManagement)).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });
});

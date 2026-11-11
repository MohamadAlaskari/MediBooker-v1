import { messages } from '@medibooker/i18n';
import type { Page, TestInfo } from '@playwright/test';
import { STUB_CODE, STUB_RECOVERY_CODE } from './support/auth-stub';
import { API_STUB_PORT } from './support/ports';
import { expect, expectAccessibleAtBothWidths, test } from './support/test';

const STUB = `http://127.0.0.1:${String(API_STUB_PORT)}`;
const PASSWORD = 'a synthetic passphrase';
const NOTE = 'Synthetic note: I may come ten minutes late.';

type Locale = 'ar' | 'en';
type Role = 'STAFF' | 'DOCTOR' | 'ADMIN';

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

/** A staff account as the operator's command leaves it: a role, and maybe a second factor. */
async function staffAccount(
  testInfo: TestInfo,
  { role, secondFactor }: { readonly role?: Role; readonly secondFactor?: boolean },
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

/** A member of the team, signed in with both factors, on the day of the practice. */
async function onTheDay(page: Page, testInfo: TestInfo, role: Role = 'STAFF'): Promise<Locale> {
  const locale = localeOf(testInfo);
  await signInFromDashboard(
    page,
    locale,
    await staffAccount(testInfo, { role, secondFactor: true }),
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
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('complementary')).toContainText(
      selected(desk(locale).shell.role, 'ADMIN'),
    );
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

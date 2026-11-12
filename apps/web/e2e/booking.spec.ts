import { GetPublicPracticeResponse } from '@medibooker/api-client/zod';
import { isolate, messages } from '@medibooker/i18n';
import type { BrowserContext, Locator, Page, Request, TestInfo } from '@playwright/test';
import {
  appointmentsOf,
  booked,
  chooseSelfPay,
  chooseTime,
  confirm,
  confirmationOf,
  DOCTOR,
  enterPerson,
  enterSignIn,
  expectBooked,
  filled,
  hook,
  joinedWithInsurance,
  joinPractice,
  localeOf,
  morningTimes,
  nameOf,
  newAddress,
  openDay,
  otherThan,
  PASSWORD,
  patientOf,
  pickTime,
  pressConfirm,
  register,
  rowsOf,
  sendDetails,
  signedIn,
  startOf,
  toList,
  type Locale,
} from './support/journey';
import { API_STUB_PORT } from './support/ports';
import { ASKS_LITTLE_ID, OCEAN_ID, PRACTICE_ID, PRACTICES, SERVICE_ID } from './support/practices';
import { expect, expectAccessible, expectAccessibleAtBothWidths, test } from './support/test';

const STUB = `http://127.0.0.1:${String(API_STUB_PORT)}`;
const PHONE = '+966 11 000 0000';
/** The first day of the next week, and the one time its doctor has then. */
const NEXT_WEEK_FIRST_TIME = '2026-11-15T06:00:00Z';
const NEXT_WEEK_DOCTOR_TIME = '2026-11-15T06:30:00Z';
/** What the stub calls the service, per language. */
const SERVICE = { ar: 'فحص', en: 'Check-up' } as const;
const INSURER = 'Synthetic Care';
const INSURANCE_NUMBER = 'AN-4821-77';

const BOOK = '**/api/v1/practices/*/appointments';
const AN_APPOINTMENT = '**/api/v1/practices/*/appointments/*';
const CANCEL = `${AN_APPOINTMENT}/cancel`;
const MOVE = `${AN_APPOINTMENT}/reschedule`;
const MY_PRACTICES = '**/api/v1/me/practices';
const PROFILE = '**/api/v1/me/profile';
const PUBLIC_PAGE = '**/api/v1/public/practices/al-noor';

function pageHeading(page: Page): Locator {
  return page.getByRole('heading', { level: 1 });
}

function statusRegion(page: Page, text: string): Locator {
  return page.getByRole('main').getByRole('status').filter({ hasText: text });
}

/** From the list to the page for moving its one appointment. */
async function toReschedule(page: Page, locale: Locale): Promise<void> {
  const { portal } = messages[locale];
  await page.getByRole('listitem').getByRole('link', { name: portal.list.reschedule }).click();
  await expect(page.getByRole('heading', { name: portal.reschedule.title })).toBeVisible();
}

/** Booked, and on the page for moving that appointment. */
async function atReschedule(page: Page, locale: Locale, email: string): Promise<void> {
  await booked(page, locale, email);
  await toList(page, locale);
  await toReschedule(page, locale);
}

/** On the confirm card of a move: the chooser starts on the doctor, who has one time. */
async function atConfirmCard(page: Page, locale: Locale, email: string): Promise<void> {
  await atReschedule(page, locale, email);
  await openDay(page, locale);
  await pickTime(page, locale, 0);
}

interface Refused {
  readonly status: number;
  readonly code: string;
}

function asProblem({ status, code }: Refused): {
  status: number;
  contentType: string;
  body: string;
} {
  return {
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify({ status, code }),
  };
}

/** Answers one method of a route by itself, as the API would for what the stub cannot reach. */
async function refuse(page: Page, url: string, refused: Refused, method = 'POST'): Promise<void> {
  await page.route(url, async (route) => {
    if (route.request().method() === method) await route.fulfill(asProblem(refused));
    else await route.fallback();
  });
}

/** Keeps a write to a route waiting until the test lets go: a slow API, which may then refuse it. */
async function holdWrites(page: Page, url: string, answer?: Refused): Promise<() => void> {
  let letGo = (): void => undefined;
  const waiting = new Promise<void>((resolve) => {
    letGo = resolve;
  });
  await page.route(url, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fallback();
      return;
    }
    await waiting;
    if (answer === undefined) await route.fallback();
    else await route.fulfill(asProblem(answer));
  });
  return letGo;
}

/** Every request of a method to a path that ends so, as the test goes on. */
function requestsTo(page: Page, method: string, ending: RegExp): readonly Request[] {
  const sent: Request[] = [];
  page.on('request', (request) => {
    const isApi = new URL(request.url()).pathname.startsWith('/api/v1/');
    if (isApi && request.method() === method && ending.test(request.url())) sent.push(request);
  });
  return sent;
}

function keysOf(requests: readonly Request[]): readonly (string | undefined)[] {
  return requests.map((request) => request.headers()['idempotency-key']);
}

/** In another tab, by hand: what a person does while this one stands open. */
async function inAnotherTab(
  context: BrowserContext,
  path: string,
  work: (other: Page) => Promise<void>,
): Promise<void> {
  const other = await context.newPage();
  await other.goto(path);
  await work(other);
  await other.close();
}

/** Signed in, on the booking page of the installation's practice, with its free times (B07). */
async function atTheTimes(page: Page, locale: Locale, testInfo: TestInfo): Promise<void> {
  await signedIn(page, locale, newAddress(testInfo));
  await page.goto(`/${locale}/book/al-noor`);
  await expect(morningTimes(page, locale).first()).toBeVisible();
}

/** Presses Tab until this element has the focus: what a keyboard reaches. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let press = 0; press < 100; press += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('The keyboard does not reach this element');
}

async function expectRing(target: Locator): Promise<void> {
  await expect(target).toHaveCSS('outline-style', 'solid');
}

// A reveal or a chip that fades in is not what a page is judged by.
test.use({ reducedMotion: 'reduce' });
// Each test has a person of its own, and the file would otherwise take minutes in one worker.
test.describe.configure({ mode: 'parallel' });

test.describe('booking on the web (08 B04)', () => {
  test('books a chosen time: asks for the details the first time, lists it, and cancels it', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal, auth } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);

    await chooseTime(page, locale);
    await expect(page).toHaveURL(`/${locale}/book/al-noor`);
    // RT-92: nothing has gone to the practice yet, and the page says what will.
    const main = page.getByRole('main');
    await expect(main).toContainText(startOf(portal.join.body));
    await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByLabel(auth.details.firstName, { exact: true })).toBeVisible();
    await enterPerson(page, locale);
    await expect(page.getByRole('radio', { name: auth.details.PUBLIC })).toBeChecked();
    expect(await patientOf(email)).toBeNull();
    await chooseSelfPay(page, locale);
    await sendDetails(page, locale);
    expect(await patientOf(email)).toMatchObject({ insuranceType: 'SELF_PAY' });

    await page.getByLabel(portal.book.noteLabel).fill('Synthetic note');
    await expectAccessibleAtBothWidths(page, 'the review');
    await pressConfirm(page, locale);
    await expect(page.getByRole('heading', { name: portal.book.bookedTitle })).toBeFocused();
    await expectAccessibleAtBothWidths(page, 'the confirmation');
    const [appointment] = await appointmentsOf(email);
    expect(appointment?.patientNote).toBe('Synthetic note');
    await expect(page.getByText('Synthetic note')).toHaveCount(0);

    await toList(page, locale);
    const row = rowsOf(page, locale);
    await expect(row).toHaveCount(1);
    await expectAccessibleAtBothWidths(page, 'the list');

    const cancelButton = row.getByRole('button', { name: portal.list.cancel });
    await cancelButton.click();
    const dialog = page.getByRole('dialog', { name: portal.cancel.title });
    await expectAccessibleAtBothWidths(page, 'the cancel dialog');
    await dialog.getByRole('button', { name: portal.cancel.keep }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toHaveCount(1);
    await expect(cancelButton).toBeFocused();

    await cancelButton.click();
    await dialog.getByRole('button', { name: portal.cancel.confirm }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(portal.list.empty)).toBeVisible();
    await page.getByRole('tab', { name: portal.list.past }).click();
    await expect(page.getByRole('tabpanel').getByText(portal.status.CANCELLED)).toBeVisible();
    expect((await appointmentsOf(email)).map(({ status }) => status)).toEqual(['CANCELLED']);
  });

  test('goes straight to the review at a practice already joined', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal, auth } = messages[locale];
    await signedIn(page, locale, newAddress(testInfo));
    await chooseTime(page, locale);
    await joinPractice(page, locale);

    await chooseTime(page, locale, { index: 1 });
    await expect(page.getByRole('heading', { name: portal.book.reviewTitle })).toBeVisible();
    await expect(page.getByLabel(auth.details.firstName, { exact: true })).toHaveCount(0);
  });

  test('a first booking at another practice asks for the details there', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal, auth } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await joinPractice(page, locale);

    await chooseTime(page, locale, { slug: 'ocean' });
    await expect(page).toHaveURL(`/${locale}/book/ocean`);
    await expect(
      page.getByRole('heading', {
        name: filled(portal.join.title, { practice: isolate(nameOf('ocean', locale)) }),
      }),
    ).toBeVisible();
    await expect(page.getByLabel(auth.details.firstName, { exact: true })).toBeVisible();
    expect(await patientOf(email, OCEAN_ID)).toBeNull();
    await joinPractice(page, locale);
    expect(await patientOf(email, OCEAN_ID)).not.toBeNull();
    await pressConfirm(page, locale);
    await expectBooked(page, locale);
    await expect(page).toHaveURL(new RegExp(`/${locale}/appointments/${OCEAN_ID}/`));
  });

  test('a member of staff books as a patient there first: a staff row is no patient', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal, auth } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await hook('staff-row', { email, practiceId: PRACTICE_ID });
    await page.goto(`/${locale}/appointments`);
    await expect(page.getByText(portal.list.noPractices)).toBeVisible();

    await chooseTime(page, locale);
    await expect(page.getByLabel(auth.details.firstName, { exact: true })).toBeVisible();
    await joinPractice(page, locale);
    await pressConfirm(page, locale);
    await expectBooked(page, locale);
  });

  test('a time someone else just took: says so, and leads back to the times', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal, errors } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await joinPractice(page, locale);

    await hook('take-time', { email, startsAt: NEXT_WEEK_FIRST_TIME });

    await pressConfirm(page, locale);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(errors.SLOT_NOT_AVAILABLE);
    await expect(page.getByRole('button', { name: portal.book.confirm })).toHaveCount(0);
    const otherTime = page.getByRole('button', { name: portal.reschedule.other });
    await expect(otherTime).toBeFocused();
    await otherTime.click();
    // Back to the times on the same page, which asks for them again.
    await expect(page).toHaveURL(`/${locale}/book/al-noor`);
    await expect(page.getByText(portal.book.chooseBody)).toBeVisible();
    await expect(pageHeading(page)).toBeFocused();
  });

  test('a double press books one appointment', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await joinPractice(page, locale);
    await page.getByRole('button', { name: portal.book.confirm }).dblclick();
    await expectBooked(page, locale);
    expect(await appointmentsOf(email)).toHaveLength(1);
  });

  test('a retry after a lost answer sends the same key, and books once', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { errors } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await joinPractice(page, locale);
    const sent = requestsTo(page, 'POST', /\/appointments$/);
    await hook('lose-answer', { email });

    await pressConfirm(page, locale);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(errors.NETWORK_ERROR);
    expect(await appointmentsOf(email)).toHaveLength(1);

    await pressConfirm(page, locale);
    await expectBooked(page, locale);
    expect(await appointmentsOf(email)).toHaveLength(1);
    const keys = keysOf(sent);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  test('a calendar file names the practice and never the service', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await booked(page, locale, newAddress(testInfo));

    const fileFrom = async (): Promise<string> => {
      const waiting = page.waitForEvent('download');
      await page.getByRole('button', { name: portal.book.addToCalendar }).click();
      const download = await waiting;
      expect(download.suggestedFilename()).toBe(`${portal.book.calendarFileName}.ics`);
      let file = '';
      for await (const chunk of await download.createReadStream()) file += String(chunk);
      return file;
    };
    const summary = filled(portal.book.calendarSummary, { practice: nameOf('al-noor', locale) });
    const expectFile = (file: string): void => {
      expect(file).toContain('BEGIN:VEVENT');
      expect(file).toContain(`SUMMARY:${summary}`);
      for (const service of ['Check-up', 'Vaccination', 'فحص']) {
        expect(file).not.toContain(service);
      }
    };
    expectFile(await fileFrom());

    // From the details too, once the practice's name has loaded.
    await page.reload();
    await expect(page.getByRole('main')).toContainText(nameOf('al-noor', locale));
    expectFile(await fileFrom());
  });

  test('moves an appointment to another free time, and keeps and names its doctor', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    await atReschedule(page, locale, email);
    const [old] = await appointmentsOf(email);

    await expect(page.getByRole('radio', { name: DOCTOR })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('main')).toContainText(startOf(portal.reschedule.current));
    await expectAccessibleAtBothWidths(page, 'the chooser');
    await openDay(page, locale);
    // The day's heading comes right after the page's.
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(1);
    // The chooser starts on the appointment's doctor, who has one time in the morning.
    await expect(morningTimes(page, locale)).toHaveCount(1);
    await pickTime(page, locale, 0);
    await expect(page.getByRole('heading', { name: portal.reschedule.confirmTitle })).toBeFocused();
    await expect(page.getByRole('main')).toContainText(
      filled(portal.reschedule.withDoctor, { doctor: isolate(DOCTOR) }),
    );
    await expectAccessibleAtBothWidths(page, 'the confirm card');
    expect((await appointmentsOf(email)).map(({ status }) => status)).toEqual(['BOOKED']);
    await page.getByRole('button', { name: portal.reschedule.confirm }).click();

    await expect(page.getByRole('heading', { name: SERVICE[locale] })).toBeVisible();
    const stored = await appointmentsOf(email);
    expect(stored.map(({ status }) => status).toSorted()).toEqual(['BOOKED', 'CANCELLED']);
    const moved = stored.find(({ status }) => status === 'BOOKED');
    expect(moved?.startsAt).toBe(NEXT_WEEK_DOCTOR_TIME);
    expect(moved?.id).not.toBe(old?.id);
    await expect(page).toHaveURL(`/${locale}/appointments/${PRACTICE_ID}/${moved?.id ?? ''}`);
    await expect(page.getByRole('main')).toContainText('09:30');
  });

  test('moving to any doctor says that the practice assigns one, and another time starts over', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal, practicePage } = messages[locale];
    await atReschedule(page, locale, newAddress(testInfo));
    await page.getByRole('radio', { name: practicePage.freeTimes.anyDoctor }).click();
    await openDay(page, locale);
    // Of that day's two in the morning, the one the person holds is on offer no more.
    await expect(morningTimes(page, locale)).toHaveCount(1);
    await pickTime(page, locale, 0);
    await expect(page.getByRole('main')).toContainText(portal.reschedule.practiceAssigns);

    await page.getByRole('button', { name: portal.reschedule.other }).click();
    await expect(page.getByRole('heading', { name: portal.reschedule.title })).toBeFocused();
    // A move without a word of the person stays with the doctor it has.
    await expect(page.getByRole('radio', { name: DOCTOR })).toHaveAttribute('aria-checked', 'true');
  });

  test('a time too close to change: offers neither, and says whom to call', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await booked(page, locale, newAddress(testInfo), { soon: true });
    await expect(page.getByRole('main')).toContainText(portal.book.bookedBodyCall);
    await toList(page, locale);
    const row = rowsOf(page, locale);
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('button', { name: portal.list.cancel })).toHaveCount(0);
    await expect(row.getByRole('link', { name: portal.list.reschedule })).toHaveCount(0);
    await expect(row).toContainText(portal.appointment.tooLate);
    await expect(row).toContainText(portal.appointment.callNowOnly);

    await row.getByRole('link').click();
    const main = page.getByRole('main');
    await expect(main).toContainText(portal.appointment.tooLate);
    await expect(main).toContainText(startOf(portal.appointment.callNow));
    await expect(main).toContainText(PHONE);
    await expect(main).not.toContainText(startOf(portal.appointment.call));
    await expect(main.getByRole('link', { name: portal.list.reschedule })).toHaveCount(0);
    await expect(main.getByRole('button', { name: portal.cancel.confirm })).toHaveCount(0);

    // The same by its address: nothing to choose.
    await page.goto(`${new URL(page.url()).pathname}/reschedule`);
    await expect(page.getByRole('heading', { name: portal.reschedule.closedTitle })).toBeVisible();
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    await expect(main).toContainText(portal.appointment.tooLate);
    await expect(main).toContainText(PHONE);
    await expect(main).not.toContainText(startOf(portal.reschedule.current));
    await expect(main.getByRole('link', { name: portal.details.title })).toBeVisible();
    await expect(main.getByRole('link', { name: portal.details.back })).toBeVisible();
    // Not on loading a page: only when a press found out.
    await expect(pageHeading(page)).not.toBeFocused();
  });

  test('says which practices it could not read, by reason, and shows the rest', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    await booked(page, locale, email);
    // A time that can still change says where.
    await expect(page.getByRole('main')).toContainText(portal.book.bookedBody);
    await hook('missing', { email, reasons: 'TIMEOUT,LIMIT' });

    await page.goto(`/${locale}/appointments`);
    await expect(rowsOf(page, locale)).toHaveCount(1);
    const name = locale === 'ar' ? 'عيادة أخرى' : 'Other practice';
    const notes = page.getByRole('main').getByRole('note');
    const failed = notes.filter({ hasText: startOf(portal.list.unavailable) });
    await expect(failed).toContainText(`${name} 1`);
    await expect(failed.getByRole('button', { name: portal.list.retry })).toBeVisible();
    const beyond = notes.filter({ hasText: startOf(portal.list.limit) });
    await expect(beyond).toContainText(`${name} 2`);
    await expect(beyond.getByRole('button')).toHaveCount(0);
  });

  for (const reason of ['UNAVAILABLE', 'TIMEOUT', 'LIMIT'] as const) {
    test(`does not say "no upcoming" while a practice is missing: ${reason}`, async ({
      page,
    }, testInfo) => {
      const locale = localeOf(testInfo);
      const { portal } = messages[locale];
      const email = newAddress(testInfo);
      await signedIn(page, locale, email);
      await hook('missing', { email, reasons: reason });
      await page.goto(`/${locale}/appointments`);

      const notice = page
        .getByRole('main')
        .getByRole('note')
        .filter({
          hasText: startOf(reason === 'LIMIT' ? portal.list.limit : portal.list.unavailable),
        });
      await expect(notice).toBeVisible();
      await expect(page.getByText(portal.list.empty)).toHaveCount(0);
      if (reason === 'LIMIT') {
        await expect(notice.getByRole('button')).toHaveCount(0);
        return;
      }
      // The next try can pass.
      await hook('missing', { email });
      await notice.getByRole('button', { name: portal.list.retry }).click();
      await expect(notice).toHaveCount(0);
      await expect(page.getByText(portal.list.empty)).toBeVisible();
      await expect(pageHeading(page)).toBeFocused();
    });
  }

  test('starts with the free times of the practice, on this page (B07)', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await atTheTimes(page, locale, testInfo);
    await expect(pageHeading(page)).toHaveText(portal.book.title);
    await expect(page.getByText(portal.book.chooseBody)).toBeVisible();
    await expectAccessibleAtBothWidths(page, 'the free times on the booking page');
  });

  test('a visitor signs in first, and comes back to the booking page', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const email = newAddress(testInfo);
    await register(email, locale);
    await confirm(email);

    await page.goto(`/${locale}/book/al-noor`);
    await expect(page).toHaveURL(
      `/${locale}/sign-in#next=${encodeURIComponent(`/${locale}/book/al-noor`)}`,
    );
    await enterSignIn(page, locale, email);
    await expect(page).toHaveURL(`/${locale}/book/al-noor`);
    await expect(morningTimes(page, locale).first()).toBeVisible();
  });

  test('an address not confirmed yet: asks for that first, before any time', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { auth, portal } = messages[locale];
    const email = newAddress(testInfo);
    await register(email, locale);
    await page.goto(`/${locale}/sign-in`);
    await enterSignIn(page, locale, email);
    await expect(page).toHaveURL(`/${locale}/home`);

    await page.goto(`/${locale}/book/al-noor`);
    await expect(page.getByText(portal.book.confirmEmailTitle)).toBeVisible();
    await expect(morningTimes(page, locale)).toHaveCount(0);
    await expectAccessibleAtBothWidths(page, 'the notice to confirm the address');

    await page.goto(`/${locale}/verify-email#token=${await confirmationOf(email)}`);
    await page.getByLabel(auth.passwordLabel, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: auth.verifyEmail.submit }).click();
    await expect(page.getByRole('heading', { name: auth.verifyEmail.doneTitle })).toBeVisible();
    await chooseTime(page, locale);
    await expect(page.getByLabel(auth.details.firstName, { exact: true })).toBeVisible();
  });

  test('asks for the privacy notice only when the API says it is missing', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await hook('needs-consent', { email });
    await chooseTime(page, locale);
    await enterPerson(page, locale);
    await chooseSelfPay(page, locale);
    const box = page.locator('[data-slot="checkbox"] label > span[aria-hidden]');
    await expect(box).toHaveCount(0);

    const submit = page.getByRole('button', { name: portal.join.submit });
    await submit.click();
    // Says why at once, and the box takes the focus.
    await expect(box).toBeVisible();
    await expect(page.getByText(portal.join.consentRequired)).toBeVisible();
    await expect(page.getByRole('checkbox')).toBeFocused();
    await expectAccessibleAtBothWidths(page, 'the insurance step with the consent box');

    await submit.click();
    await expect(page.getByRole('checkbox')).toBeFocused();
    await box.click();
    await submit.click();
    await expect(page.getByRole('heading', { name: portal.book.reviewTitle })).toBeVisible();
  });

  test('a field the API refuses in the first step takes the focus when that step comes back', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { auth, portal } = messages[locale];
    const { details } = auth;
    await signedIn(page, locale, newAddress(testInfo));
    await chooseTime(page, locale);
    await page.getByLabel(details.firstName, { exact: true }).fill('Sami');
    await page.getByLabel(details.lastName, { exact: true }).fill('Beispiel');
    // A date to come: only the API judges that.
    await page.getByLabel(details.dateOfBirth, { exact: true }).fill('2030-01-01');
    await page.getByRole('button', { name: details.continue }).click();
    await chooseSelfPay(page, locale);
    await page.getByRole('button', { name: portal.join.submit }).click();
    await expect(page.getByLabel(details.dateOfBirth, { exact: true })).toBeFocused();
  });

  test('sends what the form shows: a cleared phone goes as none, and it says which number goes', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { auth, portal } = messages[locale];
    const { details } = auth;
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await page.goto(`/${locale}/account/details`);
    await page.getByLabel(details.firstName, { exact: true }).fill('Sami');
    await page.getByLabel(details.lastName, { exact: true }).fill('Beispiel');
    await page.getByLabel(details.dateOfBirth, { exact: true }).fill('1990-04-12');
    await page.getByLabel(details.phone, { exact: true }).fill('+966500000000');
    await page.getByRole('button', { name: details.continue }).click();
    await page.getByLabel(details.insuranceProvider, { exact: true }).fill(INSURER);
    await page.getByLabel(details.insuranceNumber, { exact: true }).fill(INSURANCE_NUMBER);
    await page.getByRole('button', { name: details.save }).click();
    await expect(page).toHaveURL(`/${locale}/account`);

    await chooseTime(page, locale);
    const phone = page.getByLabel(details.phone, { exact: true });
    await expect(phone).toHaveValue('+966500000000');
    await phone.fill('');
    await page.getByRole('button', { name: details.continue }).click();
    await expect(page.getByRole('main')).toContainText(startOf(portal.join.numberGoes));
    await sendDetails(page, locale);

    expect(await patientOf(email)).toMatchObject({
      phone: null,
      insuranceProvider: INSURER,
      insuranceNumberEnd: '2177',
    });
  });

  test('asks only for what this practice asks: no provider and no number here', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { auth, portal } = messages[locale];
    await signedIn(page, locale, newAddress(testInfo));
    await chooseTime(page, locale, { slug: 'asks-little' });
    await expect(page).toHaveURL(`/${locale}/book/asks-little`);
    await enterPerson(page, locale);
    await expect(page.getByRole('radio', { name: auth.details.PUBLIC })).toBeChecked();
    await expect(page.getByLabel(auth.details.insuranceProvider, { exact: true })).toHaveCount(0);
    await expect(page.getByLabel(auth.details.insuranceNumber, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: portal.join.submit }).click();
    await expect(page.getByRole('heading', { name: portal.book.reviewTitle })).toBeVisible();
  });

  test('a practice takes its own types: an account on another starts on the first it offers', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { auth, portal, validation } = messages[locale];
    const { details } = auth;
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await page.goto(`/${locale}/account/details`);
    await enterPerson(page, locale);
    await page.getByLabel(details.insuranceProvider, { exact: true }).fill(INSURER);
    await page.getByLabel(details.insuranceNumber, { exact: true }).fill(INSURANCE_NUMBER);
    await page.getByRole('button', { name: details.save }).click();
    await expect(page).toHaveURL(`/${locale}/account`);

    await chooseTime(page, locale, { slug: 'private-only' });
    await page.getByRole('button', { name: details.continue }).click();
    await expect(page.getByRole('radio', { name: details.PUBLIC })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: details.PRIVATE })).toBeChecked();
    await expect(page.getByRole('radio', { name: details.SELF_PAY })).not.toBeChecked();
    // Of another type, so the number of the account does not come along.
    await page.getByRole('button', { name: portal.join.submit }).click();
    await expect(page.getByLabel(details.insuranceNumber, { exact: true })).toBeFocused();
    await expect(page.getByText(validation.REQUIRED).first()).toBeVisible();

    await page.getByLabel(details.insuranceNumber, { exact: true }).fill('PR-1234-56');
    await sendDetails(page, locale);
    expect(await patientOf(email, PRACTICES['private-only']?.('en').id)).toMatchObject({
      insuranceType: 'PRIVATE',
      insuranceProvider: INSURER,
      insuranceNumberEnd: '3456',
    });
  });

  test('the API refuses a number in the format of the market: next to its field', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { auth, portal, validation } = messages[locale];
    const { details } = auth;
    await signedIn(page, locale, newAddress(testInfo));
    await chooseTime(page, locale, { slug: 'lindenhof' });
    await enterPerson(page, locale);
    await page.getByLabel(details.insuranceProvider, { exact: true }).fill(INSURER);
    const number = page.getByLabel(details.insuranceNumber, { exact: true });
    await number.fill(INSURANCE_NUMBER);
    await page.getByRole('button', { name: portal.join.submit }).click();
    await expect(page.getByText(validation.INVALID_VALUE)).toBeVisible();
    await expect(number).toBeFocused();

    await number.fill('A123456789');
    await sendDetails(page, locale);
  });

  test('a limit of new practices says tomorrow, and sends nothing', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { errors, portal } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await hook('join-limit', { email });
    await chooseTime(page, locale);
    await enterPerson(page, locale);
    await chooseSelfPay(page, locale);
    await page.getByRole('button', { name: portal.join.submit }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(errors.JOIN_LIMIT_REACHED);
    expect(await patientOf(email)).toBeNull();
  });

  test('joined in another tab meanwhile: goes on to the review', async ({
    page,
    context,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await enterPerson(page, locale);
    await chooseSelfPay(page, locale);

    await inAnotherTab(context, `/${locale}/appointments`, async (other) => {
      await other.evaluate(async (practiceId) => {
        const csrf = document.cookie.split('; ').find((one) => one.startsWith('mb_csrf='));
        await fetch(`/api/v1/practices/${practiceId}/me/patients`, {
          method: 'POST',
          headers: { 'x-csrf-token': csrf?.slice('mb_csrf='.length) ?? '' },
          body: JSON.stringify({
            firstName: 'Sami',
            lastName: 'Beispiel',
            dateOfBirth: '1990-04-12',
            insuranceType: 'SELF_PAY',
          }),
        });
      }, PRACTICE_ID);
    });
    expect(await patientOf(email)).not.toBeNull();

    await sendDetails(page, locale);
  });

  test('moves the focus through the steps, and not on first load', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { auth, portal } = messages[locale];
    const { details } = auth;
    const name = isolate(nameOf('al-noor', locale));
    await signedIn(page, locale, newAddress(testInfo));
    await page.goto(`/${locale}/book/al-noor`);
    await expect(morningTimes(page, locale).first()).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    // The time had the focus, and the details take its place (B07): their heading takes it.
    await openDay(page, locale);
    await pickTime(page, locale, 0);
    await expect(
      page.getByRole('heading', { name: filled(portal.join.title, { practice: name }) }),
    ).toBeFocused();

    await page.getByLabel(details.firstName, { exact: true }).fill('Sami');
    await page.getByLabel(details.lastName, { exact: true }).fill('Beispiel');
    await page.getByLabel(details.dateOfBirth, { exact: true }).fill('1990-04-12');
    const firstStep = await page.getByRole('button', { name: details.continue }).elementHandle();
    await page.getByRole('button', { name: details.continue }).click();
    await expect(
      page.getByRole('heading', { name: filled(portal.join.insuranceTitle, { practice: name }) }),
    ).toBeFocused();
    // Nothing of the first step stays: a second press would send what nobody has read.
    expect(await firstStep.evaluate((button) => button.isConnected)).toBe(false);

    await page.getByRole('button', { name: details.back }).click();
    await expect(
      page.getByRole('heading', { name: filled(portal.join.title, { practice: name }) }),
    ).toBeFocused();
    await page.getByRole('button', { name: details.continue }).click();
    await chooseSelfPay(page, locale);
    await sendDetails(page, locale);
    await expect(page.getByRole('heading', { name: portal.book.title })).toBeFocused();
  });

  test('a number half typed and then not asked for goes nowhere', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { details } = messages[locale].auth;
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await enterPerson(page, locale);
    await page.getByLabel(details.insuranceNumber, { exact: true }).fill('abc');
    await chooseSelfPay(page, locale);
    await sendDetails(page, locale);
    expect(await patientOf(email)).toMatchObject({
      insuranceType: 'SELF_PAY',
      insuranceNumberEnd: null,
    });
  });

  test('a look for changes that fails keeps what was typed', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { details } = messages[locale].auth;
    await page.clock.install();
    await signedIn(page, locale, newAddress(testInfo));
    await page.goto(`/${locale}/account/details`);
    await enterPerson(page, locale);
    await chooseSelfPay(page, locale);
    await page.getByRole('button', { name: details.save }).click();
    await expect(page).toHaveURL(`/${locale}/account`);

    await chooseTime(page, locale);
    const firstName = page.getByLabel(details.firstName, { exact: true });
    await expect(firstName).toHaveValue('Sami');
    await firstName.fill('Salma');

    await refuse(page, PROFILE, { status: 429, code: 'RATE_LIMITED' }, 'GET');
    const refused = page.waitForResponse((answer) => answer.url().endsWith('/me/profile'));
    // Older than a query's 30 seconds, and the person comes back to the tab.
    await page.clock.fastForward('00:31');
    await page.evaluate(() => {
      window.dispatchEvent(new Event('visibilitychange'));
    });
    await refused;
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(firstName).toHaveValue('Salma');
  });

  test('the same time again: says the person has it, instead of booking twice', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal, errors } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await joinPractice(page, locale);
    await pressConfirm(page, locale);
    await expectBooked(page, locale);

    // A page that still offers it, as an answer of before would: a new attempt, with a new key.
    await page.route('**/free-times*', async (route) => {
      const date = new URL(route.request().url()).searchParams.get('date') ?? '';
      await route.fulfill({ json: { date, times: [{ startsAt: NEXT_WEEK_FIRST_TIME }] } });
    });
    await chooseTime(page, locale);
    await pressConfirm(page, locale);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(errors.APPOINTMENT_OVERLAP);
    await expect(page.getByRole('button', { name: portal.book.confirm })).toHaveCount(0);
    expect(await appointmentsOf(email)).toHaveLength(1);
  });

  test('the pages of a person are never stored', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    await signedIn(page, locale, newAddress(testInfo));
    for (const path of ['appointments', 'book/al-noor']) {
      const answer = await page.goto(`/${locale}/${path}`);
      expect(answer?.headers()['cache-control']).toContain('no-store');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    }
  });

  test('when a practice now asks for more: the details first, the note stays, and it books', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { auth, portal, validation } = messages[locale];
    const { details } = auth;
    const email = newAddress(testInfo);
    await joinedWithInsurance(page, locale, email);
    await page.getByLabel(portal.book.noteLabel).fill('Synthetic note');
    await hook('profile-incomplete', { email });

    await pressConfirm(page, locale);
    const name = isolate(nameOf('asks-little', locale));
    await expect(
      page.getByRole('heading', { name: filled(portal.join.updateTitle, { practice: name }) }),
    ).toBeFocused();
    await expect(page.getByRole('main')).toContainText(portal.join.updateBody);
    await expectAccessibleAtBothWidths(page, 'the update step');

    await page.getByRole('button', { name: details.continue }).click();
    await expect(
      page.getByRole('heading', { name: filled(portal.join.insuranceTitle, { practice: name }) }),
    ).toBeFocused();
    // The person enters what is asked for now: the page says so, and the API takes it.
    const provider = page.getByLabel(details.insuranceProvider, { exact: true });
    await expect(provider).toBeVisible();
    await page.getByRole('button', { name: portal.join.updateSubmit }).click();
    await expect(provider).toBeFocused();
    await expect(page.getByText(validation.REQUIRED).first()).toBeVisible();
    await provider.fill(INSURER);
    await page.getByLabel(details.insuranceNumber, { exact: true }).fill(INSURANCE_NUMBER);
    await page.getByRole('button', { name: portal.join.updateSubmit }).click();

    await expect(page.getByRole('heading', { name: portal.book.title })).toBeFocused();
    await expect(page.getByLabel(portal.book.noteLabel)).toHaveValue('Synthetic note');
    await pressConfirm(page, locale);
    await expectBooked(page, locale);
    const [appointment] = await appointmentsOf(email);
    expect(appointment?.patientNote).toBe('Synthetic note');
    expect(await patientOf(email, ASKS_LITTLE_ID)).toMatchObject({
      insuranceProvider: INSURER,
      insuranceNumberEnd: '2177',
      firstName: 'Sami',
    });
  });

  test('a move is refused for an incomplete profile: the details, then the same move', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { auth, portal } = messages[locale];
    const { details } = auth;
    const email = newAddress(testInfo);
    await joinedWithInsurance(page, locale, email);
    await pressConfirm(page, locale);
    await expectBooked(page, locale);
    await toList(page, locale);
    await toReschedule(page, locale);
    await openDay(page, locale);
    await pickTime(page, locale, 0);
    const sent = requestsTo(page, 'POST', /\/reschedule$/);
    await hook('profile-incomplete', { email });

    const move = page.getByRole('button', { name: portal.reschedule.confirm });
    await move.click();
    const name = isolate(nameOf('asks-little', locale));
    await expect(
      page.getByRole('heading', { name: filled(portal.join.updateTitle, { practice: name }) }),
    ).toBeFocused();
    await page.getByRole('button', { name: details.continue }).click();
    await expect(
      page.getByRole('heading', { name: filled(portal.join.insuranceTitle, { practice: name }) }),
    ).toBeFocused();
    await page.getByLabel(details.insuranceProvider, { exact: true }).fill(INSURER);
    await page.getByLabel(details.insuranceNumber, { exact: true }).fill(INSURANCE_NUMBER);
    await page.getByRole('button', { name: portal.join.updateSubmit }).click();

    await expect(page.getByRole('heading', { name: portal.reschedule.confirmTitle })).toBeFocused();
    await move.click();
    await expect(page.getByRole('heading', { name: SERVICE[locale] })).toBeVisible();
    const keys = keysOf(sent);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect((await appointmentsOf(email)).map(({ startsAt }) => startsAt)).toContain(
      NEXT_WEEK_DOCTOR_TIME,
    );
  });

  test('a note is sent without what a screen would not show, or not at all', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    const hidden = [0x200f, 0x200e, 0xad].map((code) => String.fromCodePoint(code)).join('');
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await joinPractice(page, locale);
    await page.getByLabel(portal.book.noteLabel).fill(`${hidden}Pain\tin the back${hidden}`);
    await pressConfirm(page, locale);
    await expectBooked(page, locale);

    await chooseTime(page, locale);
    await page.getByLabel(portal.book.noteLabel).fill(`  ${hidden} \n `);
    await pressConfirm(page, locale);
    await expectBooked(page, locale);

    const notes = (await appointmentsOf(email)).map(({ patientNote }) => patientNote);
    expect(notes).toEqual(['Pain in the back', undefined]);
  });

  test('a refused note: the field says so and takes the focus', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await joinPractice(page, locale);
    await hook('refuse-note', { email });
    const note = page.getByLabel(portal.book.noteLabel);
    await note.fill('Synthetic note');
    await pressConfirm(page, locale);
    await expect(page.getByText(portal.book.noteRefused)).toBeVisible();
    await expect(note).toBeFocused();
    await expect(note).toHaveValue('Synthetic note');
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    expect(await appointmentsOf(email)).toEqual([]);
  });

  /** What a press can answer about a choice: its own words, no Confirm, and the way to the times. */
  const choiceGone: readonly {
    readonly name: string;
    readonly hookName: string;
    readonly params?: Readonly<Record<string, string>>;
    readonly withDoctor?: boolean;
    readonly text: (locale: Locale) => string;
  }[] = [
    {
      name: 'a doctor who has left the public page',
      hookName: 'hide-doctor',
      withDoctor: true,
      text: (locale) => messages[locale].portal.book.timeGone,
    },
    {
      name: 'a service no longer online',
      hookName: 'service-offline',
      text: (locale) => messages[locale].errors.SERVICE_NOT_BOOKABLE,
    },
    {
      name: 'a time past the booking window',
      hookName: 'booking-window',
      params: { maxHorizonDays: '1' },
      text: (locale) => messages[locale].errors.OUTSIDE_BOOKING_WINDOW,
    },
  ];
  for (const { name, hookName, params, withDoctor, text } of choiceGone) {
    test(`says so for ${name}, and leads back to the times`, async ({ page }, testInfo) => {
      const locale = localeOf(testInfo);
      const { portal } = messages[locale];
      const email = newAddress(testInfo);
      await signedIn(page, locale, email);
      await chooseTime(page, locale, withDoctor === true ? { withDoctor } : {});
      await joinPractice(page, locale);
      await hook(hookName, { email, ...params });
      await pressConfirm(page, locale);
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(text(locale));
      await expect(page.getByRole('button', { name: portal.book.confirm })).toHaveCount(0);
      await expect(page.getByRole('button', { name: portal.reschedule.other })).toBeFocused();
      expect(await appointmentsOf(email)).toEqual([]);
    });
  }

  test('the limit of a practice is named with its number', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { errors, portal } = messages[locale];
    const email = newAddress(testInfo);
    await booked(page, locale, email);
    await hook('booking-limit', { email, max: '1' });
    await chooseTime(page, locale);
    await pressConfirm(page, locale);
    const alert = page.getByRole('main').getByRole('alert');
    await expect(alert).toContainText(startOf(errors.BOOKING_LIMIT_REACHED));
    await expect(alert).toContainText(/[1١]/);
    await expect(page.getByRole('button', { name: portal.book.confirm })).toBeVisible();
    expect(await appointmentsOf(email)).toHaveLength(1);
  });

  test('a limit only counts what is to come: a visit that has been leaves a place', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await joinPractice(page, locale);
    await hook('past-visit', { email, count: '2' });
    await hook('booking-limit', { email, max: '1' });
    await pressConfirm(page, locale);
    await expectBooked(page, locale);
  });

  test('when the list of practices fails, joins nobody and books nothing, and tries again', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { auth, errors, portal } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await joinPractice(page, locale);
    await hook('practices-limited', { email, times: '1' });
    // A new page: its list of practices fails, which the times do not need, but the next step does.
    await chooseTime(page, locale);

    await expect(pageHeading(page)).toHaveText(portal.book.title);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(errors.RATE_LIMITED);
    await expect(page.getByLabel(auth.details.firstName, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: portal.list.retry }).click();
    await expect(page.getByRole('heading', { name: portal.book.reviewTitle })).toBeVisible();
    await expect(pageHeading(page)).toBeFocused();
  });

  test('after booking the address is the appointment: a reload and a language switch stay on it', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const other = otherThan(locale);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    await booked(page, locale, email);
    const [appointment] = await appointmentsOf(email);
    const path = `appointments/${PRACTICE_ID}/${appointment?.id ?? ''}`;

    // PW6 stays on screen, under the address of what was booked.
    await expect(page).toHaveURL(`/${locale}/${path}`);
    await expect(page.getByRole('heading', { name: portal.book.bookedTitle })).toBeFocused();
    await expect(page.getByRole('main')).toContainText(portal.book.bookedBody);

    await page.locator(`a[hreflang="${other}"]`).click();
    await expect(page).toHaveURL(`/${other}/${path}`);
    await expect(page.getByRole('main')).toContainText(messages[other].portal.details.title);

    await page.reload();
    await expect(page).toHaveURL(`/${other}/${path}`);
    await expect(page.getByRole('main')).toContainText(messages[other].portal.details.title);
  });

  test('a practice that is not there: says so, and shows the way on', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await signedIn(page, locale, newAddress(testInfo));
    await page.goto(`/${locale}/book/no-such-practice`);
    await expect(pageHeading(page)).toHaveText(portal.book.title);
    await expect(page.getByRole('main')).toContainText(portal.book.notFound);
    await expect(
      page.getByRole('main').getByRole('link', { name: portal.book.toAppointments }),
    ).toBeVisible();
  });

  test('a practice without a public doctor names nobody, on every page', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    await booked(page, locale, email, { slug: 'no-public-doctor' });
    await expect(page.getByRole('main')).toContainText(portal.appointment.noDoctor);
    await toList(page, locale);
    await expect(rowsOf(page, locale)).not.toContainText('Dr.');

    await toReschedule(page, locale);
    await openDay(page, locale);
    await pickTime(page, locale, 0);
    await expect(page.getByRole('main')).toContainText(portal.reschedule.practiceAssigns);
    await page.getByRole('button', { name: portal.reschedule.confirm }).click();
    await expect(page.getByRole('heading', { name: SERVICE[locale] })).toBeVisible();
    await expect(page.getByRole('main')).toContainText(portal.appointment.noDoctor);
  });

  test('a practice without a name: sentences say a practice, and no row names it', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await signedIn(page, locale, newAddress(testInfo));
    await chooseTime(page, locale, { slug: 'no-name' });
    await expect(page.getByRole('main')).toContainText(portal.list.somePractice);
    await joinPractice(page, locale);
    await expect(
      page.getByRole('main').getByText(portal.appointment.practice, { exact: true }),
    ).toHaveCount(0);
  });

  test('a session over at the last press: signs in, and comes back to the booking page', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await joinPractice(page, locale);

    await hook('end-sessions', { email });
    await pressConfirm(page, locale);
    await expect(page).toHaveURL(
      `/${locale}/sign-in#next=${encodeURIComponent(`/${locale}/book/al-noor`)}`,
    );
    await enterSignIn(page, locale, email);
    await expect(page).toHaveURL(`/${locale}/book/al-noor`);
    // The choice stays in no storage (B07): it is made again, and nothing was booked.
    await expect(page.getByText(portal.book.chooseBody)).toBeVisible();
    expect(await appointmentsOf(email)).toEqual([]);
  });

  test('a session over during the details: signs in, and comes back to the booking page', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await enterPerson(page, locale);
    await chooseSelfPay(page, locale);

    await hook('end-sessions', { email });
    await page.getByRole('button', { name: portal.join.submit }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/sign-in#next=`));
    await enterSignIn(page, locale, email);
    await expect(page).toHaveURL(`/${locale}/book/al-noor`);
    await expect(page.getByText(portal.book.chooseBody)).toBeVisible();
  });

  test('a session over before a move: signs in, and comes back to the times', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    await atConfirmCard(page, locale, email);
    await hook('end-sessions', { email });
    await page.getByRole('button', { name: portal.reschedule.confirm }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/sign-in#next=.*reschedule`));
    await enterSignIn(page, locale, email);
    await expect(page.getByRole('heading', { name: portal.reschedule.title })).toBeVisible();
  });
});

test.describe('my appointments (08 B04)', () => {
  test('a cancel says so in a status region, and the focus lands on the heading, each time', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    await booked(page, locale, email);
    await chooseTime(page, locale);
    await pressConfirm(page, locale);
    await expectBooked(page, locale);
    await page.goto(`/${locale}/appointments`);
    const rows = rowsOf(page, locale);
    await expect(rows).toHaveCount(2);

    // There before it has anything to say: what arrives together with its text is often not read.
    await expect(page.getByRole('main').getByRole('status')).toHaveText('');
    const service = isolate(SERVICE[locale]);
    const cancelFirst = async (): Promise<void> => {
      await rows.first().getByRole('button', { name: portal.list.cancel }).click();
      await page.getByRole('button', { name: portal.cancel.confirm }).click();
    };
    await cancelFirst();
    await expect(rows).toHaveCount(1);
    const said = statusRegion(page, startOf(portal.cancel.done));
    await expect(said).toContainText(service);
    await expect(pageHeading(page)).toBeFocused();

    await cancelFirst();
    await expect(rows).toHaveCount(0);
    await expect(pageHeading(page)).toBeFocused();
    await expect(said).toContainText(service);
  });

  test('names each button and link of a row after its appointment', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await booked(page, locale, newAddress(testInfo));
    await toList(page, locale);
    const row = rowsOf(page, locale);
    const service = isolate(SERVICE[locale]);
    const link = row.getByRole('link').first();
    await expect(link).toHaveAttribute('aria-label', new RegExp(service));
    await expect(link).toHaveAttribute(
      'aria-label',
      new RegExp(`${portal.list.rowLabel.split('{time}')[1] ?? ''}$`),
    );
    await expect(
      row.getByRole('button', { name: `${startOf(portal.list.cancelLabel)}${service}` }),
    ).toBeVisible();
    await expect(
      row.getByRole('link', { name: `${startOf(portal.list.rescheduleLabel)}${service}` }),
    ).toBeVisible();
    // A short name in Arabic still makes a target of 44 px.
    const box = await link.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });

  test('a stale tab that cancels what was moved: keeps its message until the dialog closes', async ({
    page,
    context,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { errors, portal } = messages[locale];
    const email = newAddress(testInfo);
    await booked(page, locale, email);
    await toList(page, locale);
    const reschedule = rowsOf(page, locale).getByRole('link', { name: portal.list.reschedule });
    const movePath = (await reschedule.getAttribute('href')) ?? '';

    await inAnotherTab(context, movePath, async (other) => {
      await openDay(other, locale);
      await pickTime(other, locale, 0);
      await other.getByRole('button', { name: portal.reschedule.confirm }).click();
      await expect(other.getByRole('heading', { name: SERVICE[locale] })).toBeVisible();
    });

    await rowsOf(page, locale).getByRole('button', { name: portal.list.cancel }).click();
    const dialog = page.getByRole('dialog', { name: portal.cancel.title });
    await dialog.getByRole('button', { name: portal.cancel.confirm }).click();
    await expect(dialog.getByRole('alert')).toHaveText(errors.INVALID_STATUS_TRANSITION);
    const close = dialog.getByRole('button', { name: portal.cancel.close });
    await expect(close).toBeFocused();
    await expect(dialog.getByRole('button')).toHaveCount(1);
    expect((await appointmentsOf(email)).map(({ status }) => status).toSorted()).toEqual([
      'BOOKED',
      'CANCELLED',
    ]);

    await close.click();
    await expect(dialog).toHaveCount(0);
    await expect(pageHeading(page)).toBeFocused();
    // Loaded again: the new appointment, which this tab had not heard of.
    await expect(rowsOf(page, locale)).toHaveCount(1);
    await expect(rowsOf(page, locale)).toContainText('09:30');
  });

  test('a cancel past its deadline by the time of the press: the same', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { errors, portal } = messages[locale];
    await booked(page, locale, newAddress(testInfo));
    await toList(page, locale);
    await refuse(page, CANCEL, { status: 409, code: 'CANCELLATION_DEADLINE_PASSED' });
    await rowsOf(page, locale).getByRole('button', { name: portal.list.cancel }).click();
    const dialog = page.getByRole('dialog', { name: portal.cancel.title });
    await dialog.getByRole('button', { name: portal.cancel.confirm }).click();
    await expect(dialog.getByRole('alert')).toHaveText(errors.CANCELLATION_DEADLINE_PASSED);
    await expect(dialog.getByRole('button', { name: portal.cancel.close })).toBeFocused();
    await dialog.getByRole('button', { name: portal.cancel.close }).click();
    await expect(pageHeading(page)).toBeFocused();
  });

  test('a limit on a cancel: stays with a way out, and says nothing the next time', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { errors, portal } = messages[locale];
    await booked(page, locale, newAddress(testInfo));
    await toList(page, locale);
    await refuse(page, CANCEL, { status: 429, code: 'RATE_LIMITED' });
    const trigger = rowsOf(page, locale).getByRole('button', { name: portal.list.cancel });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: portal.cancel.title });
    await dialog.getByRole('button', { name: portal.cancel.confirm }).click();
    await expect(dialog.getByRole('alert')).toHaveText(errors.RATE_LIMITED);

    await dialog.getByRole('button', { name: portal.cancel.keep }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: portal.cancel.confirm })).toBeVisible();
  });

  test('while a cancel runs: the dialog stays, Keep is off, and the button keeps the focus', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await booked(page, locale, newAddress(testInfo));
    await toList(page, locale);
    const letGo = await holdWrites(page, CANCEL);
    await rowsOf(page, locale).getByRole('button', { name: portal.list.cancel }).click();
    const dialog = page.getByRole('dialog', { name: portal.cancel.title });
    const confirmButton = dialog.getByRole('button', { name: portal.cancel.confirm });
    await confirmButton.click();

    await expect(confirmButton).toHaveAttribute('aria-disabled', 'true');
    await expect(confirmButton).toBeFocused();
    await expect(dialog.getByRole('button', { name: portal.cancel.keep })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    letGo();
    await expect(dialog).toHaveCount(0);
    await expect(pageHeading(page)).toBeFocused();
  });

  test('the next look fails after a cancel: says so, and the next try clears it', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    await booked(page, locale, email);
    await toList(page, locale);
    await rowsOf(page, locale).getByRole('button', { name: portal.list.cancel }).click();
    await hook('list-limited', { email, times: '1', retryAfterSeconds: '60' });
    await page.getByRole('button', { name: portal.cancel.confirm }).click();

    const stale = page.getByRole('main').getByRole('alert').filter({ hasText: portal.list.stale });
    await expect(stale).toBeVisible();
    // The row of what was cancelled is gone all the same.
    await expect(rowsOf(page, locale)).toHaveCount(0);
    await stale.getByRole('button', { name: portal.list.retry }).click();
    await expect(stale).toHaveCount(0);
    await expect(pageHeading(page)).toBeFocused();
  });

  test('another tab holds the fan-out: asks again as often as the API says, and shows the list', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { errors, portal } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await hook('list-limited', { email, times: '2', retryAfterSeconds: '1' });
    const asked = requestsTo(page, 'GET', /\/me\/appointments$/);
    await page.goto(`/${locale}/appointments`);
    await expect(page.getByText(portal.list.empty)).toBeVisible({ timeout: 15_000 });
    expect(asked).toHaveLength(3);
    await expect(page.getByText(errors.RATE_LIMITED)).toHaveCount(0);
  });

  test('a throttle of a minute: shows the error at once, after one request', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { errors, portal } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await hook('list-limited', { email, times: '1', retryAfterSeconds: '60' });
    const asked = requestsTo(page, 'GET', /\/me\/appointments$/);
    await page.goto(`/${locale}/appointments`);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(errors.RATE_LIMITED);
    expect(asked).toHaveLength(1);
    await expect(page.getByText(portal.list.empty)).toHaveCount(0);

    await page.getByRole('button', { name: portal.list.retry }).click();
    await expect(page.getByText(portal.list.empty)).toBeVisible();
    await expect(pageHeading(page)).toBeFocused();
  });

  test('a list of practices that fails is no "no practices", on either tab', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { errors, portal } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await hook('practices-limited', { email, times: '2' });
    const asked = requestsTo(page, 'GET', /\/me\/practices$/);
    await page.goto(`/${locale}/appointments`);

    const main = page.getByRole('main');
    await expect(main.getByRole('alert')).toHaveText(errors.RATE_LIMITED);
    await expect(main).not.toContainText(portal.list.noPractices);
    await page.getByRole('tab', { name: portal.list.past }).click();
    await expect(main.getByRole('alert')).toHaveText(errors.RATE_LIMITED);
    await expect(main).not.toContainText(portal.list.emptyPast);
    // A 429 is not retried by itself: one request per try.
    expect(asked).toHaveLength(1);

    await main.getByRole('button', { name: portal.list.retry }).click();
    await expect.poll(() => asked.length).toBe(2);
    await expect(main.getByRole('alert')).toHaveText(errors.RATE_LIMITED);
    await main.getByRole('button', { name: portal.list.retry }).click();
    await expect(main.getByRole('alert')).toHaveCount(0);
    await expect(pageHeading(page)).toBeFocused();
  });

  test('the empty Past tab: a list with one item that says so', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await signedIn(page, locale, newAddress(testInfo));
    await chooseTime(page, locale);
    await joinPractice(page, locale);
    await page.goto(`/${locale}/appointments`);
    await page.getByRole('tab', { name: portal.list.past }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByRole('list').getByRole('listitem')).toHaveText(portal.list.emptyPast);
    await expectAccessibleAtBothWidths(page, 'the empty Past tab');
  });

  test('a visit that has been, still booked: on the Past tab, with nothing left to manage', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const email = newAddress(testInfo);
    await signedIn(page, locale, email);
    await chooseTime(page, locale);
    await joinPractice(page, locale);
    await hook('past-visit', { email });
    await page.goto(`/${locale}/appointments`);
    await expect(page.getByText(portal.list.empty)).toBeVisible();

    await page.getByRole('tab', { name: portal.list.past }).click();
    const panel = page.getByRole('tabpanel');
    const badge = panel.locator('[data-slot="badge"]');
    await expect(badge).toHaveText(portal.status.STARTED);
    await expect(badge).toHaveAttribute('data-variant', 'neutral');

    await panel.getByRole('listitem').getByRole('link').click();
    await expect(page).toHaveURL(/#from=past$/);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: SERVICE[locale] })).toBeVisible();
    await expect(main.locator('[data-slot="badge"]')).toHaveText(portal.status.STARTED);
    await expect(main.getByRole('heading', { name: portal.details.manage })).toHaveCount(0);
    await expect(main.getByRole('button', { name: portal.book.addToCalendar })).toHaveCount(0);
    await expect(main).not.toContainText(portal.appointment.tooLate);

    // Back to where the person came from, also after the page has come to life.
    const asked = requestsTo(page, 'GET', /\/me\/appointments$/);
    await main.getByRole('link', { name: portal.details.back }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${locale}/appointments#tab=past&practice=[0-9a-f-]+&appointment=[0-9a-f-]+$`),
    );
    await expect(page.getByRole('tab', { name: portal.list.past })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tabpanel').locator('[data-slot="badge"]')).toBeVisible();
    expect(asked.length).toBeLessThanOrEqual(1);
  });

  test('a long history: shows more, and the focus lands on the first of it', async ({
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
    await page.getByRole('button', { name: portal.list.more }).click();
    await expect(links).toHaveCount(21);
    await expect(links.nth(20)).toBeFocused();
    await expect(page.getByRole('button', { name: portal.list.more })).toHaveCount(0);
  });

  test('a long name of a practice fits a phone, in several words and in one', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    const fitsAPhone = async (where: string): Promise<void> => {
      for (const width of [360, 320]) {
        await page.setViewportSize({ width, height: 700 });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${where} at ${String(width)} px`).toBeLessThanOrEqual(0);
      }
    };
    await signedIn(page, locale, newAddress(testInfo));
    for (const slug of ['long-name', 'long-word']) {
      await chooseTime(page, locale, { slug });
      await expect(page.getByRole('main')).toContainText(nameOf(slug, locale));
      await fitsAPhone(`the details for ${slug}`);
      await joinPractice(page, locale);
      await fitsAPhone(`the review at ${slug}`);
      await pressConfirm(page, locale);
      await expectBooked(page, locale);
      await fitsAPhone(`the confirmation at ${slug}`);
      await page.reload();
      await expect(page.getByRole('main')).toContainText(nameOf(slug, locale));
      await fitsAPhone(`the appointment at ${slug}`);
    }
    await page.goto(`/${locale}/appointments`);
    await expect(page.getByRole('link', { name: nameOf('long-word', locale) })).toBeVisible();
    await fitsAPhone('the upcoming list');
    await page.getByRole('tab', { name: portal.list.past }).click();
    await expect(page.getByRole('tabpanel')).toContainText(nameOf('long-word', locale));
    await fitsAPhone('the past list');
  });
});

test.describe('the details of an appointment (08 B04)', () => {
  test('a cancel there: the heading takes the focus, it says so, and the card goes', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await booked(page, locale, newAddress(testInfo));
    await page.reload();
    await expect(page.getByRole('heading', { name: portal.details.manage })).toBeVisible();

    // Also when the next read fails: what the answer said stays.
    await refuse(page, AN_APPOINTMENT, { status: 429, code: 'RATE_LIMITED' }, 'GET');
    await page.getByRole('button', { name: portal.cancel.confirm }).click();
    await page.getByRole('dialog').getByRole('button', { name: portal.cancel.confirm }).click();

    await expect(page.getByRole('heading', { name: SERVICE[locale] })).toBeFocused();
    const main = page.getByRole('main');
    await expect(main.locator('[data-slot="badge"]')).toHaveText(portal.status.CANCELLED);
    await expect(statusRegion(page, startOf(portal.cancel.done))).toBeVisible();
    await expect(main.getByRole('heading', { name: portal.details.manage })).toHaveCount(0);
    await expect(main.getByRole('alert').filter({ hasText: portal.list.stale })).toBeVisible();

    // Nothing to move any more, by its address either.
    await page.unroute(AN_APPOINTMENT);
    await page.goto(`${new URL(page.url()).pathname}/reschedule`);
    await expect(page.getByRole('heading', { name: portal.reschedule.closedTitle })).toBeVisible();
    await expect(main).toContainText(portal.reschedule.closedCancelled);
    await expect(main.locator('[data-slot="badge"]')).toHaveText(portal.status.CANCELLED);
    await expect(main).not.toContainText(startOf(portal.reschedule.current));
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
  });

  test('an appointment that is not there: says so, and leads back', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await booked(page, locale, newAddress(testInfo));
    const missing = '30000000-0000-4000-8000-00000000dead';
    await page.goto(`/${locale}/appointments/${PRACTICE_ID}/${missing}`);
    await expect(pageHeading(page)).toHaveText(portal.details.title);
    const main = page.getByRole('main');
    await expect(main).toContainText(portal.details.notFound);
    await expect(main.getByRole('link', { name: portal.details.back })).toBeVisible();
  });

  test('writes the hours of the deadline in the digits of the practice', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await booked(page, locale, newAddress(testInfo), { slug: 'closed' });
    await page.reload();
    const main = page.getByRole('main');
    await expect(main).toContainText(startOf(portal.appointment.deadline));
    await expect(main).toContainText('٢٤');
  });

  test('a list of practices that fails: no row names the practice', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await booked(page, locale, newAddress(testInfo));
    await refuse(page, MY_PRACTICES, { status: 429, code: 'RATE_LIMITED' }, 'GET');
    await page.reload();
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: SERVICE[locale] })).toBeVisible();
    await expect(main.getByText(portal.appointment.practice, { exact: true })).toHaveCount(0);
  });
});

test.describe('moving an appointment when things go otherwise (08 B04)', () => {
  test('a time someone just took: says so, no Move, and new times', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { errors, portal } = messages[locale];
    const email = newAddress(testInfo);
    await atConfirmCard(page, locale, email);
    await hook('take-time', { email, startsAt: NEXT_WEEK_DOCTOR_TIME });

    await page.getByRole('button', { name: portal.reschedule.confirm }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(errors.SLOT_NOT_AVAILABLE);
    await expect(page.getByRole('button', { name: portal.reschedule.confirm })).toHaveCount(0);
    const other = page.getByRole('button', { name: portal.reschedule.other });
    await expect(other).toBeFocused();

    const availability = page.waitForRequest((request) => request.url().includes('/availability'));
    await other.click();
    await availability;
    await expect(page.getByRole('heading', { name: portal.reschedule.title })).toBeFocused();
    expect((await appointmentsOf(email)).map(({ status }) => status)).toEqual(['BOOKED']);
  });

  test('while a move runs: the other way is off, and Move keeps the focus', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await atConfirmCard(page, locale, newAddress(testInfo));
    const letGo = await holdWrites(page, MOVE);
    const move = page.getByRole('button', { name: portal.reschedule.confirm });
    await move.click();
    await expect(move).toHaveAttribute('aria-disabled', 'true');
    await expect(move).toBeFocused();
    await expect(page.getByRole('button', { name: portal.reschedule.other })).toBeDisabled();
    letGo();
    await expect(page.getByRole('heading', { name: SERVICE[locale] })).toBeVisible();
  });

  test('cancelled elsewhere meanwhile: the page says what it is now', async ({
    page,
    context,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await atConfirmCard(page, locale, newAddress(testInfo));

    const details = new URL(page.url()).pathname.replace(/\/reschedule$/, '');
    await inAnotherTab(context, details, async (other) => {
      await other.getByRole('button', { name: portal.cancel.confirm }).click();
      await other.getByRole('dialog').getByRole('button', { name: portal.cancel.confirm }).click();
      await expect(other.getByRole('dialog')).toHaveCount(0);
    });

    await page.getByRole('button', { name: portal.reschedule.confirm }).click();
    await expect(page.getByRole('heading', { name: portal.reschedule.closedTitle })).toBeFocused();
    await expect(page.getByRole('main')).toContainText(portal.reschedule.closedCancelled);
  });

  for (const failure of ['a server failure', 'a lost connection'] as const) {
    test(`no telling after ${failure}: no Move, and the ways on`, async ({ page }, testInfo) => {
      const locale = localeOf(testInfo);
      const { portal } = messages[locale];
      await atConfirmCard(page, locale, newAddress(testInfo));
      await page.route(MOVE, async (route) => {
        if (failure === 'a lost connection') await route.abort('connectionreset');
        else await route.fulfill(asProblem({ status: 500, code: 'INTERNAL_ERROR' }));
      });
      await page.getByRole('button', { name: portal.reschedule.confirm }).click();

      const main = page.getByRole('main');
      await expect(main.getByRole('alert')).toBeVisible();
      await expect(main.getByRole('button', { name: portal.reschedule.confirm })).toHaveCount(0);
      await expect(main.getByRole('button', { name: portal.reschedule.other })).toBeFocused();
      await expect(main.getByRole('link', { name: portal.details.back })).toBeVisible();
      await expect(main).toContainText(startOf(portal.reschedule.current));
    });
  }

  test('a 404 on the press: this time is gone, no Move', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await atConfirmCard(page, locale, newAddress(testInfo));
    await refuse(page, MOVE, { status: 404, code: 'NOT_FOUND' });
    await page.getByRole('button', { name: portal.reschedule.confirm }).click();
    const main = page.getByRole('main');
    await expect(main.getByRole('alert')).toHaveText(portal.book.timeGone);
    await expect(main.getByRole('button', { name: portal.reschedule.confirm })).toHaveCount(0);
  });

  test('a practice page limited: an error and a retry, and then the chooser', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { errors, portal, practicePage } = messages[locale];
    await atReschedule(page, locale, newAddress(testInfo));
    await refuse(page, PUBLIC_PAGE, { status: 429, code: 'RATE_LIMITED' }, 'GET');
    await page.reload();

    const main = page.getByRole('main');
    await expect(main.getByRole('alert')).toHaveText(errors.RATE_LIMITED);
    await expect(main).not.toContainText(portal.reschedule.noPage);
    await page.unroute(PUBLIC_PAGE);
    await main.getByRole('button', { name: portal.list.retry }).click();
    await expect(main.getByRole('radiogroup', { name: practicePage.freeTimes.days })).toBeVisible();
    await expect(page.getByRole('heading', { name: portal.reschedule.title })).toBeFocused();
  });

  test('a practice without a page: says so, with no retry, also without a slug', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { portal } = messages[locale];
    await atReschedule(page, locale, newAddress(testInfo));
    const main = page.getByRole('main');
    const expectNoPage = async (): Promise<void> => {
      await page.reload();
      await expect(main).toContainText(portal.reschedule.noPage);
      await expect(main.getByRole('link', { name: portal.details.title })).toBeVisible();
      await expect(main.getByRole('button', { name: portal.list.retry })).toHaveCount(0);
    };

    await refuse(page, PUBLIC_PAGE, { status: 404, code: 'NOT_FOUND' }, 'GET');
    await expectNoPage();

    await page.route(MY_PRACTICES, async (route) => {
      await route.fulfill({
        json: {
          items: [{ id: PRACTICE_ID, slug: null, name: { en: 'Al Noor' }, capacity: 'PATIENT' }],
        },
      });
    });
    await expectNoPage();
  });

  test('a service no longer online reads like nothing free, with the phone and no retry', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { practicePage } = messages[locale];
    const email = newAddress(testInfo);
    await atReschedule(page, locale, email);
    await hook('service-offline', { email });
    await page.reload();
    const main = page.getByRole('main');
    await expect(main).toContainText(practicePage.freeTimes.empty);
    await expect(main.getByRole('link', { name: PHONE })).toBeVisible();
    await expect(main.getByRole('button', { name: practicePage.freeTimes.retry })).toHaveCount(0);
  });
});

test.describe('the keyboard and the focus (08 B04)', () => {
  test('a Tab shows a ring on a field, a button, a tab, a time and the rest of the picker', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { auth, portal, practicePage } = messages[locale];
    const free = practicePage.freeTimes;
    const email = newAddress(testInfo);

    // A field, on signing in.
    await register(email, locale);
    await confirm(email);
    await page.goto(`/${locale}/sign-in`);
    await expect(page.getByRole('button', { name: auth.signIn.submit })).toBeEnabled();
    const field = page.getByLabel(auth.emailLabel, { exact: true });
    await tabTo(page, field);
    await expectRing(field);
    await enterSignIn(page, locale, email);
    await expect(page).toHaveURL(`/${locale}/home`);

    // The picker, on the booking page (B07).
    await page.goto(`/${locale}/book/al-noor`);
    const section = page.getByRole('main');
    const time = section.getByRole('group', { name: free.morning }).getByRole('link').first();
    await expect(time).toBeVisible();
    const service = section.getByRole('button', { name: /Check-up/ });
    await tabTo(page, service);
    await expectRing(service);
    const day = section.getByRole('radiogroup', { name: free.days }).locator('[tabindex="0"]');
    await tabTo(page, day);
    await expectRing(day);
    await tabTo(page, time);
    await expectRing(time);
    const phone = section.getByRole('link', { name: PHONE });
    await tabTo(page, phone);
    await expectRing(phone);

    // An item of the list of services: by the keyboard, and with its own ring.
    await service.focus();
    await page.keyboard.press('Enter');
    const option = page.getByRole('option', { name: /Check-up/ });
    await expect(option).toBeFocused();
    await expectRing(option);
    await page.keyboard.press('Escape');

    // Then what the review and the list have.
    await chooseTime(page, locale);
    await joinPractice(page, locale);
    const note = page.getByLabel(portal.book.noteLabel);
    await tabTo(page, note);
    await expectRing(note);
    const confirmButton = page.getByRole('button', { name: portal.book.confirm });
    await tabTo(page, confirmButton);
    await expectRing(confirmButton);
    await pressConfirm(page, locale);
    await expectBooked(page, locale);

    await toList(page, locale);
    const cancel = rowsOf(page, locale).getByRole('button', { name: portal.list.cancel });
    await expect(cancel).toBeVisible();
    const tab = page.getByRole('tab', { name: portal.list.upcoming });
    await tabTo(page, tab);
    await expectRing(tab);
    await tabTo(page, cancel);
    await expectRing(cancel);
  });

  test('Confirm keeps the focus while it runs and after a failure', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { errors, portal } = messages[locale];
    await signedIn(page, locale, newAddress(testInfo));
    await chooseTime(page, locale);
    await joinPractice(page, locale);
    const letGo = await holdWrites(page, BOOK, { status: 503, code: 'SERVICE_UNAVAILABLE' });
    const button = page.getByRole('button', { name: portal.book.confirm });
    await button.click();
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toBeFocused();
    letGo();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(errors.SERVICE_UNAVAILABLE);
    await expect(button).toBeFocused();
    await expect(button).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('signing out keeps the focus while it runs and after a failure', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { auth, errors } = messages[locale];
    await signedIn(page, locale, newAddress(testInfo));
    const letGo = await holdWrites(page, '**/api/v1/auth/logout', {
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    const button = page.getByRole('button', { name: auth.account.signOut });
    await button.click();
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toBeFocused();
    letGo();
    await expect(
      page.getByRole('alert').filter({ hasText: errors.SERVICE_UNAVAILABLE }),
    ).toBeVisible();
    await expect(button).toBeFocused();
  });

  test('an arrow that switches itself off hands the focus to the other', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const free = messages[locale].practicePage.freeTimes;
    await atTheTimes(page, locale, testInfo);
    const next = page.getByRole('button', { name: free.nextWeek });
    const previous = page.getByRole('button', { name: free.previousWeek });
    await expect(next).toBeEnabled();
    await next.focus();
    const pressUntilOff = async (arrow: Locator): Promise<void> => {
      for (let week = 0; week < 10 && !(await arrow.isDisabled()); week += 1) {
        await page.keyboard.press('Enter');
      }
      await expect(arrow).toBeDisabled();
    };
    await pressUntilOff(next);
    await expect(previous).toBeFocused();
    await pressUntilOff(previous);
    await expect(next).toBeFocused();
  });

  test('React Aria speaks the language of the page, whatever the browser says', async ({
    page,
  }, testInfo) => {
    // Each project's browser has the other language than the page here.
    const locale = otherThan(localeOf(testInfo));
    const { portal } = messages[locale];
    await booked(page, locale, newAddress(testInfo));
    await toList(page, locale);
    await rowsOf(page, locale).getByRole('button', { name: portal.list.cancel }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
      page.getByRole('button', { name: locale === 'ar' ? 'تجاهل' : 'Dismiss' }).first(),
    ).toBeAttached();
  });

  for (const height of [256, 180]) {
    test(`a dialog on a window of 320 by ${String(height)} px can be read and left`, async ({
      page,
    }, testInfo) => {
      const locale = localeOf(testInfo);
      const { portal } = messages[locale];
      await booked(page, locale, newAddress(testInfo));
      await toList(page, locale);
      await page.setViewportSize({ width: 320, height });
      await rowsOf(page, locale).getByRole('button', { name: portal.list.cancel }).click();
      const dialog = page.getByRole('dialog', { name: portal.cancel.title });
      const title = dialog.getByRole('heading', { name: portal.cancel.title });
      await expect(title).toBeVisible();
      const box = await title.boundingBox();
      expect(box?.y).toBeGreaterThanOrEqual(0);

      const overlayTop = (): Promise<number> =>
        dialog.evaluate((element) => {
          let parent = element.parentElement;
          while (parent !== null && getComputedStyle(parent).overflowY !== 'auto') {
            parent = parent.parentElement;
          }
          return parent?.scrollTop ?? -1;
        });
      expect(await overlayTop()).toBe(0);
      await page.mouse.move(160, Math.floor(height / 2));
      await page.mouse.wheel(0, 200);
      await expect.poll(overlayTop).toBeGreaterThan(0);
      await expect(dialog).toBeVisible();

      await dialog.getByRole('button', { name: portal.cancel.keep }).click();
      await expect(dialog).toHaveCount(0);
    });
  }
});

test.describe('the picker on a phone (08 B04)', () => {
  /** Where each day of the strip lies, what its weekdays do, and that the page stays put. */
  async function measure(page: Page, locale: Locale): Promise<void> {
    const free = messages[locale].practicePage.freeTimes;
    const strip = page.getByRole('radiogroup', { name: free.days });
    const days = strip.getByRole('radio');
    await expect(days).toHaveCount(7);
    const boxes = await days.evaluateAll((buttons) =>
      buttons.map((button) => {
        const { left, right, top, bottom } = button.getBoundingClientRect();
        return { left, right, top, bottom };
      }),
    );
    const byPlace = boxes.toSorted((first, second) => first.left - second.left);
    for (const [index, box] of byPlace.entries()) {
      const next = byPlace[index + 1];
      if (next !== undefined) expect(next.left).toBeGreaterThanOrEqual(box.right);
      expect(box.right - box.left).toBeGreaterThanOrEqual(44);
      expect(box.bottom - box.top).toBeGreaterThanOrEqual(44);
    }
    // One letter a day, and none touches the next.
    const weekdays = await strip.locator('span[aria-hidden] > span:visible').evaluateAll((labels) =>
      labels.map((label) => {
        const range = document.createRange();
        range.selectNodeContents(label);
        const { left, right } = range.getBoundingClientRect();
        return { left, right };
      }),
    );
    expect(weekdays).toHaveLength(7);
    const labels = weekdays.toSorted((first, second) => first.left - second.left);
    for (const [index, label] of labels.entries()) {
      const next = labels[index + 1];
      if (next !== undefined) expect(next.left).toBeGreaterThan(label.right);
    }
    const pageScroll = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageScroll, 'the page scrolls sideways').toBeLessThanOrEqual(0);
  }

  function stripScrolls(strip: Locator): Promise<boolean> {
    return strip.evaluate((element) => element.scrollWidth > element.clientWidth);
  }

  test('seven targets fit 360 px without scrolling', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const free = messages[locale].practicePage.freeTimes;
    await page.setViewportSize({ width: 360, height: 740 });
    await atTheTimes(page, locale, testInfo);
    await measure(page, locale);
    expect(await stripScrolls(page.getByRole('radiogroup', { name: free.days }))).toBe(false);
    await expectAccessible(page, 'the picker at 360 px');
  });

  test('at 320 px the strip scrolls inside itself, and cuts off no ring', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const free = messages[locale].practicePage.freeTimes;
    await page.setViewportSize({ width: 320, height: 700 });
    await atTheTimes(page, locale, testInfo);
    await measure(page, locale);
    const strip = page.getByRole('radiogroup', { name: free.days });
    expect(await stripScrolls(strip)).toBe(true);

    // Any day, brought into view as the focus does it: its ring of 4 px stays inside.
    const ringFits = (button: Element): boolean => {
      const scroller = button.closest('[role="radiogroup"]');
      if (scroller === null) return false;
      button.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      const place = button.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      return (
        place.left - 4 >= box.left && place.right + 4 <= box.right && place.bottom + 4 <= box.bottom
      );
    };
    const days = strip.getByRole('radio');
    for (const index of [6, 3, 0]) {
      expect(await days.nth(index).evaluate(ringFits), `day ${String(index)}`).toBe(true);
    }
    await expectAccessible(page, 'the picker at 320 px');
  });

  test('a week without a free day at 320 px can still be scrolled by the keyboard', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const free = messages[locale].practicePage.freeTimes;
    // The first day has times, and nothing after it.
    await page.route('**/availability*', async (route) => {
      const days = Array.from({ length: 42 }, (_, offset) => {
        const date = new Date(Date.UTC(2026, 10, 8 + offset)).toISOString().slice(0, 10);
        return { date, hasFreeTimes: offset === 0 };
      });
      await route.fulfill({ json: { days } });
    });
    await page.setViewportSize({ width: 320, height: 700 });
    await atTheTimes(page, locale, testInfo);
    await page.getByRole('button', { name: free.nextWeek }).click();
    await expect(
      page.getByRole('radiogroup', { name: free.days }).getByRole('radio', { disabled: false }),
    ).toHaveCount(0);
    await expectAccessible(page, 'a week without a free day at 320 px');
  });
});

test.describe('every page has a title of its own (08 B04)', () => {
  test('without a sign-in', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { app, auth, errorPage, privacyPage } = messages[locale];
    const titled = [
      ['sign-in', auth.signIn.title],
      ['sign-up', auth.signUp.title],
      ['forgot-password', auth.forgot.title],
      ['reset-password#token=a-token', auth.reset.title],
      ['verify-email#token=a-token', auth.verifyEmail.title],
      ['privacy', privacyPage.title],
      ['no-such-practice', errorPage.notFoundTitle],
    ] as const;
    for (const [path, title] of titled) {
      await page.goto(`/${locale}/${path}`);
      // The installation's practice ends every title (08 I02).
      await expect(page).toHaveTitle(
        filled(app.pageTitle, { page: title, brand: nameOf('al-noor', locale) }),
      );
    }
  });

  test('of a person, and none names a service', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    const { app, auth, portal } = messages[locale];
    const email = newAddress(testInfo);
    await booked(page, locale, email);
    const [appointment] = await appointmentsOf(email);
    const details = `appointments/${PRACTICE_ID}/${appointment?.id ?? ''}`;
    const titled = [
      ['account', auth.account.title],
      ['account/details', auth.details.editTitle],
      ['check-inbox', auth.checkInbox.title],
      ['sign-up/details', auth.details.title],
      ['appointments', portal.list.title],
      [details, portal.details.title],
      [`${details}/reschedule`, portal.reschedule.title],
      ['book/al-noor', portal.book.title],
    ] as const;
    for (const [path, title] of titled) {
      await page.goto(`/${locale}/${path}`);
      // The practice is the installation's, which its address names anyway (ADR 0016).
      await expect(page).toHaveTitle(
        filled(app.pageTitle, { page: title, brand: nameOf('al-noor', locale) }),
      );
    }
  });
});

test.describe('the stub answers as the API does, route by route (08 B04)', () => {
  interface CallOptions {
    readonly body?: object;
    readonly key?: string;
    /** Leaves out what a page sends with every write. */
    readonly withoutCsrf?: boolean;
  }

  /** A session of a person, without a browser. */
  interface Session {
    readonly email: string;
    readonly call: (method: string, path: string, options?: CallOptions) => Promise<Response>;
  }

  const THE_PRACTICE = `/api/v1/practices/${PRACTICE_ID}`;
  const SOON = '2026-11-08T06:00:00Z';
  const details = {
    firstName: 'Sami',
    lastName: 'Beispiel',
    dateOfBirth: '1990-04-12',
    insuranceType: 'SELF_PAY',
  };
  const KEY = '50000000-0000-4000-8000-000000000001';
  const OTHER_KEY = '50000000-0000-4000-8000-000000000002';
  const THIRD_KEY = '50000000-0000-4000-8000-000000000003';
  const FOURTH_KEY = '50000000-0000-4000-8000-000000000004';

  async function aSession({ confirmed = true } = {}): Promise<Session> {
    const email = `stub-${newAddress(test.info())}`;
    await register(email, 'en');
    if (confirmed) await confirm(email);
    const login = await fetch(`${STUB}/api/v1/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const cookies = login.headers.getSetCookie().map((cookie) => cookie.split(';')[0] ?? '');
    const csrf = cookies.find((cookie) => cookie.startsWith('mb_csrf='))?.slice('mb_csrf='.length);
    return {
      email,
      call: (method, path, { body, key, withoutCsrf = false } = {}) =>
        fetch(`${STUB}${path}`, {
          method,
          headers: {
            cookie: cookies.join('; '),
            ...(withoutCsrf ? {} : { 'x-csrf-token': csrf ?? '' }),
            ...(key === undefined ? {} : { 'idempotency-key': key }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
    };
  }

  async function expectRefused(
    answer: Promise<Response>,
    status: number,
    code: string,
  ): Promise<void> {
    const response = await answer;
    expect(await response.json()).toMatchObject({ status, code });
    expect(response.status).toBe(status);
  }

  async function bookedAppointment(
    { call }: Session,
    startsAt = NEXT_WEEK_FIRST_TIME,
    key = KEY,
  ): Promise<string> {
    const answer = await call('POST', `${THE_PRACTICE}/appointments`, {
      body: { serviceId: SERVICE_ID, startsAt },
      key,
    });
    expect(answer.status).toBe(201);
    return ((await answer.json()) as { id: string }).id;
  }

  async function joined({ call }: Session): Promise<string> {
    const answer = await call('POST', `${THE_PRACTICE}/me/patients`, { body: details });
    expect(answer.status).toBe(201);
    return ((await answer.json()) as { id: string }).id;
  }

  test('every practice is what the contract says', async () => {
    for (const slug of Object.keys(PRACTICES)) {
      const answer = await fetch(`${STUB}/api/v1/public/practices/${slug}`);
      const practice = GetPublicPracticeResponse.safeParse(await answer.json());
      expect(practice.success, slug).toBe(true);
    }
  });

  test('another method answers 404, and nothing happens', async () => {
    const session = await aSession();
    const { call, email } = session;
    await joined(session);
    const id = await bookedAppointment(session);
    const wrong = [
      ['GET', `${THE_PRACTICE}/appointments/${id}/cancel`],
      ['GET', `${THE_PRACTICE}/appointments/${id}/reschedule`],
      ['POST', `${THE_PRACTICE}/appointments/${id}`],
      ['DELETE', `${THE_PRACTICE}/appointments/${id}`],
      ['POST', `${THE_PRACTICE}/me/patients/${id}`],
      ['POST', '/api/v1/me/practices'],
      ['POST', '/api/v1/me/appointments'],
      ['POST', `${THE_PRACTICE}/me/appointments`],
      ['POST', '/api/v1/public/practices/al-noor'],
    ] as const;
    for (const [method, path] of wrong) {
      await expectRefused(call(method, path), 404, 'NOT_FOUND');
    }
    const [row] = await appointmentsOf(email);
    expect(row?.status).toBe('BOOKED');
  });

  test('a write needs a session, then the CSRF header', async () => {
    const { call } = await aSession();
    const writes = [
      ['POST', `${THE_PRACTICE}/me/patients`],
      ['POST', `${THE_PRACTICE}/appointments`],
      ['POST', `${THE_PRACTICE}/appointments/${KEY}/cancel`],
      ['POST', `${THE_PRACTICE}/appointments/${KEY}/reschedule`],
      ['PATCH', `${THE_PRACTICE}/me/patients/${KEY}`],
    ] as const;
    for (const [method, path] of writes) {
      await expectRefused(call(method, path, { withoutCsrf: true }), 403, 'FORBIDDEN');
      await expectRefused(fetch(`${STUB}${path}`, { method }), 401, 'UNAUTHENTICATED');
    }
    await expectRefused(fetch(`${STUB}/api/v1/me/practices`), 401, 'UNAUTHENTICATED');
  });

  test('knows no patient before a join, and no practice by a slug or an unknown id', async () => {
    const { call } = await aSession();
    for (const path of [
      `${THE_PRACTICE}/me/patients`,
      `${THE_PRACTICE}/me/appointments`,
      `${THE_PRACTICE}/appointments/${KEY}`,
    ]) {
      await expectRefused(call('GET', path), 404, 'NOT_FOUND');
    }
    for (const practice of ['al-noor', KEY]) {
      await expectRefused(
        call('POST', `/api/v1/practices/${practice}/me/patients`, { body: details }),
        404,
        'NOT_FOUND',
      );
    }
  });

  test('forbids a member of staff what a patient may read', async () => {
    const { call, email } = await aSession();
    await hook('staff-row', { email, practiceId: PRACTICE_ID });
    await expectRefused(call('GET', `${THE_PRACTICE}/me/patients`), 403, 'FORBIDDEN');
  });

  test('the free times want a confirmed address, and no public route is left (B07)', async () => {
    const times = `${THE_PRACTICE}/free-times?serviceId=${SERVICE_ID}&date=2026-11-15`;
    const days = `${THE_PRACTICE}/availability?serviceId=${SERVICE_ID}`;
    for (const path of [times, days]) {
      await expectRefused(fetch(`${STUB}${path}`), 401, 'UNAUTHENTICATED');
    }
    const unconfirmed = await aSession({ confirmed: false });
    await expectRefused(unconfirmed.call('GET', times), 403, 'EMAIL_NOT_VERIFIED');
    await expectRefused(
      (await aSession()).call('GET', `/api/v1/practices/${KEY}/free-times`),
      404,
      'NOT_FOUND',
    );
    // No patient there yet: a confirmed account is enough.
    const { call } = await aSession();
    const answer = await call('GET', times);
    expect(answer.status).toBe(200);
    expect(((await answer.json()) as { times: unknown[] }).times.length).toBeGreaterThan(0);
    expect((await call('GET', days)).status).toBe(200);
    for (const route of ['slots', 'availability']) {
      const old = await fetch(`${STUB}/api/v1/public/practices/al-noor/${route}`);
      expect(old.status).toBe(404);
    }
  });

  test('a booking and a join want a confirmed address', async () => {
    const { call } = await aSession({ confirmed: false });
    await expectRefused(
      call('POST', `${THE_PRACTICE}/me/patients`, { body: details }),
      403,
      'EMAIL_NOT_VERIFIED',
    );
    await expectRefused(
      call('POST', `${THE_PRACTICE}/appointments`, {
        body: { serviceId: SERVICE_ID, startsAt: SOON },
        key: KEY,
      }),
      403,
      'EMAIL_NOT_VERIFIED',
    );
  });

  test('a join checks the lists of the practice, and a second join is refused', async () => {
    const session = await aSession();
    const { call } = session;
    const fieldsOf = async (body: object): Promise<readonly string[]> => {
      const answer = await call('POST', `${THE_PRACTICE}/me/patients`, { body });
      expect(answer.status).toBe(400);
      const { errors } = (await answer.json()) as { errors: { field: string }[] };
      return errors.map(({ field }) => field);
    };
    expect(await fieldsOf({ ...details, insuranceType: 'PUBLIC' })).toEqual([
      'insuranceProvider',
      'insuranceNumber',
    ]);
    expect(await fieldsOf({ firstName: 'Sami' })).toEqual([
      'lastName',
      'dateOfBirth',
      'insuranceType',
    ]);
    const atOther = await call(
      'POST',
      `/api/v1/practices/${PRACTICES['private-only']?.('en').id ?? ''}/me/patients`,
      { body: { ...details, insuranceType: 'PUBLIC' } },
    );
    expect(await atOther.json()).toMatchObject({
      errors: [{ field: 'insuranceType', code: 'INVALID_VALUE' }],
    });
    await joined(session);
    await expectRefused(
      call('POST', `${THE_PRACTICE}/me/patients`, { body: details }),
      409,
      'ALREADY_JOINED',
    );
  });

  test('a change keeps what is left out, and a list of one profile is a list', async () => {
    const session = await aSession();
    const { call } = session;
    const id = await joined(session);

    const changed = await call('PATCH', `${THE_PRACTICE}/me/patients/${id}`, { body: {} });
    expect(await changed.json()).toMatchObject({ firstName: 'Sami', dateOfBirth: '1990-04-12' });
    const renamed = await call('PATCH', `${THE_PRACTICE}/me/patients/${id}`, {
      body: { firstName: 'Salma' },
    });
    expect(await renamed.json()).toMatchObject({ firstName: 'Salma', lastName: 'Beispiel' });
    const one = await call('GET', `${THE_PRACTICE}/me/patients/${id}`);
    expect(await one.json()).toMatchObject({ id, firstName: 'Salma' });
    const all = await call('GET', `${THE_PRACTICE}/me/patients`);
    expect(await all.json()).toMatchObject({ items: [{ id }] });
    await expectRefused(call('GET', `${THE_PRACTICE}/me/patients/${KEY}`), 404, 'NOT_FOUND');
  });

  test('a key answers with its first result, and only for the same request', async () => {
    const session = await aSession();
    const { call, email } = session;
    await joined(session);
    const body = { serviceId: SERVICE_ID, startsAt: NEXT_WEEK_FIRST_TIME };
    const book = (extra: CallOptions): Promise<Response> =>
      call('POST', `${THE_PRACTICE}/appointments`, { body, ...extra });
    await expectRefused(book({}), 400, 'VALIDATION_FAILED');
    await expectRefused(book({ key: 'not-a-uuid' }), 400, 'VALIDATION_FAILED');

    const id = await bookedAppointment(session);
    expect(await bookedAppointment(session)).toBe(id);
    expect(await appointmentsOf(email)).toHaveLength(1);
    await expectRefused(
      book({ body: { ...body, patientNote: 'Another request' }, key: KEY }),
      409,
      'IDEMPOTENCY_KEY_REUSED',
    );
    // A new key is a new attempt, for the same time of the same person.
    await expectRefused(book({ key: OTHER_KEY }), 409, 'APPOINTMENT_OVERLAP');
  });

  test('refuses a time that is not on offer, and a note a screen would not show', async () => {
    const session = await aSession();
    await joined(session);
    const book = (body: object): Promise<Response> =>
      session.call('POST', `${THE_PRACTICE}/appointments`, { body, key: KEY });
    const startsAt = NEXT_WEEK_FIRST_TIME;
    await expectRefused(
      book({ serviceId: SERVICE_ID, startsAt: '2026-11-15T06:10:00Z' }),
      409,
      'SLOT_NOT_AVAILABLE',
    );
    await expectRefused(
      book({ serviceId: SERVICE_ID, startsAt: '2026-11-08T05:30:00Z' }),
      409,
      'OUTSIDE_BOOKING_WINDOW',
    );
    await expectRefused(book({ serviceId: KEY, startsAt }), 409, 'SERVICE_NOT_BOOKABLE');
    await expectRefused(
      book({ serviceId: SERVICE_ID, startsAt, providerId: KEY }),
      404,
      'NOT_FOUND',
    );
    const note = await book({
      serviceId: SERVICE_ID,
      startsAt,
      patientNote: `Pain${String.fromCodePoint(0x200f)}`,
    });
    expect(await note.json()).toMatchObject({ errors: [{ field: 'patientNote' }] });
  });

  test('a move has a key, a status and a deadline, and answers with its first result', async () => {
    const session = await aSession();
    const { call, email } = session;
    await joined(session);
    const id = await bookedAppointment(session);
    const move = (key: string | undefined): Promise<Response> =>
      call('POST', `${THE_PRACTICE}/appointments/${id}/reschedule`, {
        body: { startsAt: '2026-11-16T06:00:00Z' },
        ...(key === undefined ? {} : { key }),
      });

    await expectRefused(move(undefined), 400, 'VALIDATION_FAILED');
    const first = await move(OTHER_KEY);
    expect(first.status).toBe(201);
    const { id: movedId } = (await first.json()) as { id: string };
    expect(movedId).not.toBe(id);
    const again = await move(OTHER_KEY);
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ id: movedId });
    await expectRefused(move(THIRD_KEY), 409, 'INVALID_STATUS_TRANSITION');
    await expectRefused(
      call('POST', `${THE_PRACTICE}/appointments/${id}/cancel`),
      409,
      'INVALID_STATUS_TRANSITION',
    );
    expect((await appointmentsOf(email)).map(({ status }) => status)).toEqual([
      'CANCELLED',
      'BOOKED',
    ]);

    const soon = await bookedAppointment(session, SOON, THIRD_KEY);
    await expectRefused(
      call('POST', `${THE_PRACTICE}/appointments/${soon}/reschedule`, {
        body: { startsAt: '2026-11-17T06:00:00Z' },
        key: FOURTH_KEY,
      }),
      409,
      'CANCELLATION_DEADLINE_PASSED',
    );
    await expectRefused(
      call('POST', `${THE_PRACTICE}/appointments/${soon}/cancel`),
      409,
      'CANCELLATION_DEADLINE_PASSED',
    );
  });

  test('a second cancel changes nothing and answers the same', async () => {
    const session = await aSession();
    await joined(session);
    const id = await bookedAppointment(session);
    const cancel = (): Promise<Response> =>
      session.call('POST', `${THE_PRACTICE}/appointments/${id}/cancel`);
    expect(await (await cancel()).json()).toMatchObject({ status: 'CANCELLED' });
    const second = await cancel();
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: 'CANCELLED', changeable: false });
  });

  test('lists a page at a time, and a booked row that has begun as past', async () => {
    interface PageOfAppointments {
      readonly items: readonly { startsAt: string; started: boolean; status: string }[];
      readonly nextCursor: string | null;
    }

    const session = await aSession();
    const { call, email } = session;
    await joined(session);
    await hook('past-visit', { email, count: '3' });
    await bookedAppointment(session);

    const listOf = (query: string): Promise<Response> =>
      call('GET', `${THE_PRACTICE}/me/appointments?${query}`);
    const pageOf = async (query: string): Promise<PageOfAppointments> =>
      (await (await listOf(query)).json()) as PageOfAppointments;

    const first = await pageOf('scope=past&limit=2');
    expect(first.items.map(({ started, status }) => [started, status])).toEqual([
      [true, 'BOOKED'],
      [true, 'BOOKED'],
    ]);
    // Latest first.
    expect(first.items[0]?.startsAt.startsWith('2026-11-01')).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const second = await pageOf(`scope=past&limit=2&cursor=${first.nextCursor ?? ''}`);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const upcoming = await pageOf('');
    expect(upcoming.items.map(({ started }) => started)).toEqual([false]);
    await expectRefused(listOf('limit=101'), 400, 'VALIDATION_FAILED');
    await expectRefused(listOf('cursor=nonsense'), 400, 'VALIDATION_FAILED');
  });

  test('tells practices apart: a join at one is none at another', async () => {
    const session = await aSession();
    const { call } = session;
    await joined(session);
    await expectRefused(call('GET', `/api/v1/practices/${OCEAN_ID}/me/patients`), 404, 'NOT_FOUND');
    const practices = await call('GET', '/api/v1/me/practices');
    expect(await practices.json()).toMatchObject({
      items: [{ id: PRACTICE_ID, slug: 'al-noor', capacity: 'PATIENT' }],
    });
  });
});

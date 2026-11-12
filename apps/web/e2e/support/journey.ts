/**
 * A person's way through the pages, for the tests: an account, a chosen time, the details, a booking.
 */
import { messages } from '@medibooker/i18n';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { API_STUB_PORT } from './ports';
import { PRACTICE_ID, PRACTICES } from './practices';
import { expect } from './test';

const STUB = `http://127.0.0.1:${String(API_STUB_PORT)}`;
export const PASSWORD = 'a synthetic passphrase';
export const DOCTOR = 'Dr. Lina Mansour';

export type Locale = 'ar' | 'en';

export function localeOf({ project }: TestInfo): Locale {
  return project.name.startsWith('ar') ? 'ar' : 'en';
}

export function otherThan(locale: Locale): Locale {
  return locale === 'ar' ? 'en' : 'ar';
}

export function newAddress({ project, repeatEachIndex, retry, testId }: TestInfo): string {
  return `booking-${project.name}-${testId}-${String(repeatEachIndex)}-${String(retry)}@example.test`;
}

/** The fixed text of a message before its first placeholder. */
export function startOf(message: string): string {
  return message.split('{')[0] ?? '';
}

export function filled(message: string, values: Readonly<Record<string, string>>): string {
  return message.replaceAll(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}

export function nameOf(slug: string, locale: Locale): string {
  return PRACTICES[slug]?.(locale).name ?? '';
}

export async function hook(name: string, params: Record<string, string>): Promise<Response> {
  const answer = await fetch(`${STUB}/__${name}?${new URLSearchParams(params).toString()}`);
  expect(answer.ok, `the hook ${name}`).toBe(true);
  return answer;
}

export interface StoredAppointment {
  readonly id: string;
  readonly status: string;
  readonly startsAt: string;
  readonly patientNote: string | undefined;
}

export async function appointmentsOf(email: string): Promise<StoredAppointment[]> {
  const answer = await hook('appointments', { email });
  return (await answer.json()) as StoredAppointment[];
}

export interface StoredPatient {
  readonly phone: string | null;
  readonly firstName: string;
  readonly insuranceType: string;
  readonly insuranceProvider: string | null;
  readonly insuranceNumberEnd: string | null;
}

export async function patientOf(
  email: string,
  practiceId = PRACTICE_ID,
): Promise<StoredPatient | null> {
  const answer = await hook('patient', { email, practiceId });
  return (await answer.json()) as StoredPatient | null;
}

export async function register(email: string, locale: Locale): Promise<void> {
  await fetch(`${STUB}/api/v1/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD, locale }),
  });
}

export async function confirmationOf(email: string): Promise<string> {
  const links = (await (await hook('links', { email })).json()) as { confirm: string };
  return links.confirm;
}

export async function confirm(email: string): Promise<void> {
  await fetch(`${STUB}/api/v1/auth/verify-email`, {
    method: 'POST',
    body: JSON.stringify({ token: await confirmationOf(email), password: PASSWORD }),
  });
}

export async function enterSignIn(page: Page, locale: Locale, email: string): Promise<void> {
  const { auth } = messages[locale];
  await page.getByLabel(auth.emailLabel, { exact: true }).fill(email);
  await page.getByLabel(auth.passwordLabel, { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: auth.signIn.submit }).click();
}

/**
 * A person with a confirmed address: where a sign-in without another way back lands. The page has
 * come to life and asked what it asks: a button pressed before that does nothing, and a limit set
 * for the next question would go to this one.
 */
export async function signedIn(page: Page, locale: Locale, email: string): Promise<void> {
  await register(email, locale);
  await confirm(email);
  await page.goto(`/${locale}/sign-in`);
  const answered = ['/me/practices', '/me/appointments'].map((path) =>
    page.waitForResponse((answer) => answer.url().endsWith(path)),
  );
  await enterSignIn(page, locale, email);
  // A sign-in without a way back lands on the home (PW2, B06), which reads both.
  await expect(page).toHaveURL(`/${locale}/home`);
  await Promise.all(answered);
}

export interface Choice {
  /** Which of the morning's times that are free for this person. */
  readonly index?: number;
  /** The first free day: too close to change. Otherwise a day of the next week. */
  readonly soon?: boolean;
  readonly slug?: string;
  /** Asks for the practice's doctor by name, who has one time in the morning. */
  readonly withDoctor?: boolean;
}

export async function openDay(
  page: Page,
  locale: Locale,
  { soon = false }: Choice = {},
): Promise<void> {
  const free = messages[locale].practicePage.freeTimes;
  if (soon) return;
  await page.getByRole('button', { name: free.nextWeek }).click();
  await page
    .getByRole('radiogroup', { name: free.days })
    .getByRole('radio', { disabled: false })
    .first()
    .click();
}

export function morningTimes(page: Page, locale: Locale): Locator {
  const free = messages[locale].practicePage.freeTimes;
  return page.getByRole('group', { name: free.morning }).getByRole('link');
}

export async function pickTime(page: Page, locale: Locale, index: number): Promise<void> {
  await morningTimes(page, locale).nth(index).click();
}

/** On the booking page of a practice, signed in (B07): the installation's own by default. */
export async function chooseTime(page: Page, locale: Locale, choice: Choice = {}): Promise<void> {
  await page.goto(`/${locale}/book/${choice.slug ?? 'al-noor'}`);
  if (choice.withDoctor === true) await page.getByRole('radio', { name: DOCTOR }).click();
  await openDay(page, locale, choice);
  await pickTime(page, locale, choice.index ?? 0);
}

export async function enterPerson(page: Page, locale: Locale): Promise<void> {
  const { details } = messages[locale].auth;
  await page.getByLabel(details.firstName, { exact: true }).fill('Sami');
  await page.getByLabel(details.lastName, { exact: true }).fill('Beispiel');
  await page.getByLabel(details.dateOfBirth, { exact: true }).fill('1990-04-12');
  await page.getByRole('button', { name: details.continue }).click();
}

export async function sendDetails(page: Page, locale: Locale): Promise<void> {
  const { portal } = messages[locale];
  await page.getByRole('button', { name: portal.join.submit }).click();
  await expect(page.getByRole('heading', { name: portal.book.reviewTitle })).toBeVisible();
}

export async function chooseSelfPay(page: Page, locale: Locale): Promise<void> {
  const { details } = messages[locale].auth;
  await page.getByRole('radio', { name: details.SELF_PAY }).check({ force: true });
}

/** The steps of a first booking at a practice, for someone who pays for it. */
export async function joinPractice(page: Page, locale: Locale): Promise<void> {
  await enterPerson(page, locale);
  await chooseSelfPay(page, locale);
  await sendDetails(page, locale);
}

export async function pressConfirm(page: Page, locale: Locale): Promise<void> {
  await page.getByRole('button', { name: messages[locale].portal.book.confirm }).click();
}

export async function expectBooked(page: Page, locale: Locale): Promise<void> {
  const { portal } = messages[locale];
  await expect(page.getByRole('heading', { name: portal.book.bookedTitle })).toBeVisible();
}

/** Signed in, with a booked appointment, on its confirmation. */
export async function booked(
  page: Page,
  locale: Locale,
  email: string,
  choice: Choice = {},
): Promise<void> {
  await signedIn(page, locale, email);
  await chooseTime(page, locale, choice);
  await joinPractice(page, locale);
  await pressConfirm(page, locale);
  await expectBooked(page, locale);
}

/** At a practice that asks for no number and no provider, with insurance: BR-09 can change that. */
export async function joinedWithInsurance(
  page: Page,
  locale: Locale,
  email: string,
): Promise<void> {
  await signedIn(page, locale, email);
  await chooseTime(page, locale, { slug: 'asks-little' });
  await enterPerson(page, locale);
  await sendDetails(page, locale);
}

export function rowsOf(page: Page, locale: Locale): Locator {
  return page.getByRole('listitem').filter({ hasText: messages[locale].portal.status.BOOKED });
}

/** From the confirmation to the list. */
export async function toList(page: Page, locale: Locale): Promise<void> {
  const { portal } = messages[locale];
  await page.getByRole('main').getByRole('link', { name: portal.book.toAppointments }).click();
  await expect(page).toHaveURL(`/${locale}/appointments`);
}

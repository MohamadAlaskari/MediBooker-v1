/**
 * The time a visitor chose on a practice's page, on its way through signing in to the booking. It
 * stays out of the URL, also out of its fragment: a URL stays in the browser's history, where a
 * service and a doctor say something about someone on a shared computer.
 *
 * `sessionStorage` is the one exception to "no web storage" (03 §13), and it is not free of risk: it
 * survives a reload and a restored tab, and is bound to no account, so whoever signs in next in this
 * tab would see the choice. So it lasts only as long as a sign-in takes, is cleared by the booking, by
 * signing out, and by anyone signing in in another tab, and holds ids and a time, nothing that names a
 * person.
 */

const KEY = 'medibooker.booking-choice';
const ID = /^[0-9a-f-]{36}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?Z$/;
/** Enough to sign in or sign up. A choice older than this is chosen again. */
const LIFETIME_MS = 15 * 60 * 1000;

export interface BookingChoice {
  readonly slug: string;
  readonly serviceId: string;
  readonly startsAt: string;
  readonly providerId?: string | undefined;
}

/** A browser can refuse its storage: then the visitor chooses again after signing in. */
export function saveChoice(choice: BookingChoice, now: number = Date.now()): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...choice, savedAt: now }));
  } catch {
    // Nothing to do: the booking page says that no time was chosen.
  }
  expireChoice(now);
}

export function clearChoice(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was stored, then.
  }
}

/** What is stored, as it is. */
export function readRawChoice(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function isRecent(savedAt: unknown, now: number): savedAt is number {
  return typeof savedAt === 'number' && savedAt <= now && now - savedAt <= LIFETIME_MS;
}

function fieldsOf(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

let expiry: ReturnType<typeof setTimeout> | undefined;

/**
 * Makes the fifteen minutes true of what is stored, not only of what a page accepts: a tab left open
 * on a shared computer keeps no old choice. Removes one that is over or is none, and looks again when
 * the one stored now is over. One timer per document, called by saving and when a document starts.
 */
export function expireChoice(now: number = Date.now()): void {
  clearTimeout(expiry);
  const raw = readRawChoice();
  if (raw === null) return;
  const savedAt = fieldsOf(raw)?.savedAt;
  if (isRecent(savedAt, now)) {
    expiry = setTimeout(expireChoice, savedAt + LIFETIME_MS - now + 1);
  } else {
    clearChoice();
  }
}

/** The choice for this practice, if what is stored is a recent one: it could have been changed by hand. */
export function parseChoice(
  raw: string | null,
  slug: string,
  now: number = Date.now(),
): BookingChoice | undefined {
  if (raw === null) return undefined;
  const fields = fieldsOf(raw);
  if (fields === undefined) return undefined;
  const { slug: of, serviceId, startsAt, providerId, savedAt } = fields;
  if (!isRecent(savedAt, now)) return undefined;
  if (of !== slug || typeof serviceId !== 'string' || !ID.test(serviceId)) return undefined;
  if (typeof startsAt !== 'string' || !INSTANT.test(startsAt)) return undefined;
  if (providerId !== undefined && (typeof providerId !== 'string' || !ID.test(providerId))) {
    return undefined;
  }
  return { slug, serviceId, startsAt, ...(providerId === undefined ? {} : { providerId }) };
}

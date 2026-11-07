import { isApiError, type AppointmentDto, type MyPracticeDto } from '@medibooker/api-client';
import { isolate, isolateLtr } from '@medibooker/i18n';
import { practiceFormat, type PracticeFormat } from '@/lib/format';

const SLUG = /^[a-z0-9-]{1,64}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NO_BREAK_SPACE = String.fromCodePoint(0xa0);

/**
 * A phone number inside a sentence. Whole: a number broken over two lines of a right-to-left text
 * shows its parts in the wrong order, and a message cannot hold markup for a style.
 */
export function phoneInSentence(phone: string): string {
  return isolateLtr(phone.replaceAll(' ', NO_BREAK_SPACE));
}

/**
 * A name someone wrote, inside a sentence of this page: whatever its language, it keeps its order and
 * leaves the sentence's alone. Without a name, the page's own words for it. Not for a calendar file,
 * which keeps no marks that nobody can see.
 */
export function nameInSentence(name: string | null | undefined, fallback: string): string {
  return name === null || name === undefined || name === '' ? fallback : isolate(name);
}

/** A slug or an id from the address: anything else never reaches a URL of the API. */
export function isPracticeSlug(value: string): boolean {
  return SLUG.test(value);
}

export function isId(value: string): boolean {
  return ID.test(value);
}

/** A text kept per language: in this one, or in whatever language there is. */
export function textIn(texts: Readonly<Record<string, string>>, locale: string): string {
  return texts[locale] ?? Object.values(texts)[0] ?? '';
}

/** How the times of an appointment read: as its practice writes them. */
export function formatOf(appointment: AppointmentDto, locale: string): PracticeFormat {
  return practiceFormat(locale, appointment);
}

/** The parts of a sentence about an instant, in the practice's zone. With its year: a history has many. */
export function whenParts(
  format: PracticeFormat,
  instant: string,
): { readonly date: string; readonly time: string } {
  return {
    date: format.dayLongWithYear(format.instantDate(instant)),
    time: format.instantTime(instant),
  };
}

export function practiceById(
  practices: readonly MyPracticeDto[] | undefined,
  id: string,
): MyPracticeDto | undefined {
  return practices?.find((practice) => practice.id === id);
}

/** The names of practices in one sentence part, for a notice about them. */
export function practiceNames(
  ids: readonly string[],
  practices: readonly MyPracticeDto[] | undefined,
  locale: string,
  fallback: string,
): string {
  const names = ids.map((id) => {
    const practice = practiceById(practices, id);
    return nameInSentence(practice === undefined ? '' : textIn(practice.name, locale), fallback);
  });
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
}

/** What a press on a time can answer when that choice cannot be had: only another one can. */
const CHOICE_GONE: ReadonlySet<string> = new Set([
  'SLOT_NOT_AVAILABLE',
  'APPOINTMENT_OVERLAP',
  'OUTSIDE_BOOKING_WINDOW',
  'SERVICE_NOT_BOOKABLE',
  // A doctor or a service that left the practice's public page in the meantime.
  'NOT_FOUND',
]);

export function isChoiceGone(error: unknown): boolean {
  return isApiError(error) && CHOICE_GONE.has(error.code);
}

/** No answer to go by: the request may have gone through. */
export function isOutcomeUnknown(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  if (!isApiError(error)) return true;
  return error.status === 0 || error.status >= 500 || error.code === 'UNEXPECTED_RESPONSE';
}

/** What a note may not hold (`NOTE_TEXT` of the API), except line breaks and the joiners. */
const NOT_FOR_A_NOTE = /(?![\n\u{200C}\u{200D}])[\p{C}\p{Zl}\p{Zp}]/gu;
const OTHER_LINE_BREAK = /[\u{2028}\u{2029}]/gu;
const READABLE = /[^\s\u{200C}\u{200D}]/u;

/**
 * A note as the API takes it. Text pasted from a chat or a document holds direction marks and the
 * like, which nobody can see to remove, so they go here. What is then left to read may be nothing,
 * and the note is optional.
 */
export function noteToSend(written: string): string | undefined {
  const note = written
    .replaceAll('\t', ' ')
    .replaceAll(OTHER_LINE_BREAK, '\n')
    .replaceAll(NOT_FOR_A_NOTE, '');
  return READABLE.test(note) ? note : undefined;
}

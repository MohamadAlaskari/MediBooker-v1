import type { FieldErrorCode } from '../../../common/errors/field-error-codes.js';

/**
 * What the team sets up for the practice (M02): its services, opening hours and special days. The
 * checks here need no database; the database keeps its own (CHECK, EXCLUDE, UNIQUE).
 */

export interface FieldProblem {
  readonly field: string;
  readonly code: FieldErrorCode;
}

export interface Checked<T> {
  readonly problems: readonly FieldProblem[];
  readonly value: T;
}

/** A service's name, as the public page and the app show it. */
export const SERVICE_NAME_MAX = 80;
/** The note patients read before and after booking (Figma W13). */
export const SERVICE_DESCRIPTION_MAX = 500;
/** The label of a special day, such as "Team training". */
export const SPECIAL_DAY_LABEL_MAX = 80;
/** How far ahead a special day can be set: two years of the practice's calendar. */
export const SPECIAL_DAY_HORIZON_DAYS = 730;

/**
 * A text the team writes for patients, with a visible character and without what a screen would not
 * show or would disguise it with (as the note of an appointment): one line for a name or label. The
 * fillers of Hangul and the blank Braille pattern are letters and symbols that show nothing, so they
 * are no visible character either (security review of M02).
 */
export const LINE_TEXT =
  /^(?=.*[^\s\u{115F}\u{1160}\u{2800}\u{3164}\u{FFA0}\u{200C}\u{200D}])(?:[^\p{C}\p{Zl}\p{Zp}]|[\u{200C}\u{200D}])+$/u;
/** The same over several lines, for a note. */
export const LINES_TEXT =
  /^(?=[\s\S]*[^\s\u{115F}\u{1160}\u{2800}\u{3164}\u{FFA0}\u{200C}\u{200D}])(?:[^\p{C}\p{Zl}\p{Zp}]|[\n\u{200C}\u{200D}])+$/u;
/** A key that can be a language code: an unknown one is named, anything else is not repeated. */
const LOCALE_KEY = /^[A-Za-z0-9-]{1,35}$/u;

/** A local wall-clock time; 24:00 is the end of the day. */
export const CLOCK_PATTERN = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;
const END_OF_DAY = 24 * 60;

/** Minutes after local midnight of a time of `CLOCK_PATTERN`. */
export function minutesOf(clock: string): number {
  const [hours = '0', minutes = '0'] = clock.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/**
 * Texts per locale: only the practice's locales, each a string of at most `max` characters after
 * trimming, of the pattern's characters. A required text needs every locale, because patients read
 * it in the one they use. Empty texts of an optional field are left out. An unknown key is named
 * when it can be a language code; any other is one error of the whole field, so that an answer
 * never repeats what a client chose (security review of M02).
 */
export function textsOf(
  field: string,
  input: Readonly<Record<string, unknown>>,
  locales: readonly string[],
  {
    required,
    max,
    pattern,
  }: { readonly required: boolean; readonly max: number; readonly pattern: RegExp },
): Checked<Record<string, string>> {
  const problems: FieldProblem[] = [];
  const value: Record<string, string> = {};
  let odd = false;
  for (const [locale, text] of Object.entries(input)) {
    if (!locales.includes(locale)) {
      if (LOCALE_KEY.test(locale)) {
        problems.push({ field: `${field}.${locale}`, code: 'UNKNOWN_FIELD' });
      } else {
        odd = true;
      }
    } else if (typeof text !== 'string') {
      problems.push({ field: `${field}.${locale}`, code: 'INVALID_TYPE' });
    } else if (text.trim().length > max) {
      problems.push({ field: `${field}.${locale}`, code: 'TOO_LONG' });
    } else if (text.trim() !== '' && !pattern.test(text.trim())) {
      problems.push({ field: `${field}.${locale}`, code: 'INVALID_FORMAT' });
    } else if (text.trim() !== '') {
      value[locale] = text.trim();
    }
  }
  if (odd) problems.push({ field, code: 'UNKNOWN_FIELD' });
  if (required) {
    for (const locale of locales) {
      const given = input[locale];
      if (given === undefined || (typeof given === 'string' && given.trim() === '')) {
        problems.push({ field: `${field}.${locale}`, code: 'REQUIRED' });
      }
    }
  }
  return { problems, value };
}

/** One interval of the week as the team enters it. */
export interface IntervalInput {
  readonly weekday: number;
  readonly opensAt: string;
  readonly closesAt: string;
}

/** One interval of the week as the database keeps it. */
export interface IntervalRow {
  readonly weekday: number;
  readonly opensAt: number;
  readonly closesAt: number;
}

/**
 * The week's intervals in minutes, in the order given: an interval opens before the day ends and
 * closes after it opens. An overlap is the database's to find (EXCLUDE), which names the interval.
 */
export function intervalsOf(intervals: readonly IntervalInput[]): Checked<readonly IntervalRow[]> {
  const problems: FieldProblem[] = [];
  const value = intervals.map(({ weekday, opensAt, closesAt }, index) => {
    const row = { weekday, opensAt: minutesOf(opensAt), closesAt: minutesOf(closesAt) };
    if (row.opensAt === END_OF_DAY) {
      problems.push({ field: `intervals[${String(index)}].opensAt`, code: 'INVALID_VALUE' });
    } else if (row.closesAt <= row.opensAt) {
      problems.push({ field: `intervals[${String(index)}].closesAt`, code: 'TOO_SMALL' });
    }
    return row;
  });
  return { problems, value };
}

/** A special day as the team enters it. */
export interface SpecialDayInput {
  readonly date: Temporal.PlainDate;
  readonly closed: boolean;
  readonly opensAt?: string | undefined;
  readonly closesAt?: string | undefined;
}

/** The hours of a special day in minutes: none when closed. */
export interface SpecialDayHours {
  readonly opensAt: number | null;
  readonly closesAt: number | null;
}

/**
 * A special day from today to two years ahead on the practice's calendar: closed without hours, or
 * open with both, the opening before the closing.
 */
export function specialDayOf(
  { date, closed, opensAt, closesAt }: SpecialDayInput,
  today: Temporal.PlainDate,
): Checked<SpecialDayHours> {
  const problems: FieldProblem[] = [];
  if (Temporal.PlainDate.compare(date, today) < 0) {
    problems.push({ field: 'date', code: 'TOO_SMALL' });
  } else if (Temporal.PlainDate.compare(date, today.add({ days: SPECIAL_DAY_HORIZON_DAYS })) > 0) {
    problems.push({ field: 'date', code: 'TOO_LARGE' });
  }
  if (closed) {
    if (opensAt !== undefined) problems.push({ field: 'opensAt', code: 'INVALID_VALUE' });
    if (closesAt !== undefined) problems.push({ field: 'closesAt', code: 'INVALID_VALUE' });
    return { problems, value: { opensAt: null, closesAt: null } };
  }
  if (opensAt === undefined) problems.push({ field: 'opensAt', code: 'REQUIRED' });
  if (closesAt === undefined) problems.push({ field: 'closesAt', code: 'REQUIRED' });
  if (opensAt === undefined || closesAt === undefined) {
    return { problems, value: { opensAt: null, closesAt: null } };
  }
  const hours = { opensAt: minutesOf(opensAt), closesAt: minutesOf(closesAt) };
  if (hours.opensAt === END_OF_DAY) {
    problems.push({ field: 'opensAt', code: 'INVALID_VALUE' });
  } else if (hours.closesAt <= hours.opensAt) {
    problems.push({ field: 'closesAt', code: 'TOO_SMALL' });
  }
  return { problems, value: hours };
}

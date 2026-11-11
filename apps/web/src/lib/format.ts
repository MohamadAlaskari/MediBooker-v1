import { toFormattingLocale } from '@medibooker/i18n';

/** The settings of a practice that decide how its dates and times read (03 §8). */
export interface PracticeFormatSettings {
  readonly numberingSystem: string;
  readonly hourCycle: string;
  readonly timeZone: string;
}

export interface PracticeFormat {
  /** A wall-clock time of the practice such as `08:30`; `24:00` reads as midnight. */
  readonly clock: (wallClock: string) => string;
  /** The name of an ISO weekday, 1 Monday to 7 Sunday. */
  readonly weekday: (isoWeekday: number) => string;
  /** A date of the practice such as `2026-11-19`. */
  readonly day: (isoDate: string) => string;
  /** The year of such a date, with the practice's digits. */
  readonly year: (isoDate: string) => string;
  /** Such a date in full: "Wednesday, 4 November". */
  readonly dayLong: (isoDate: string) => string;
  /** The same with its year, for what can lie in another one: "Wednesday, 4 November 2026". */
  readonly dayLongWithYear: (isoDate: string) => string;
  /** A date without its weekday, such as a date of birth: "12 April 1990". */
  readonly calendarDate: (isoDate: string) => string;
  /** Its month and year: "November 2026". */
  readonly monthYear: (isoDate: string) => string;
  /** Its short weekday: "Wed". */
  readonly weekdayShort: (isoDate: string) => string;
  /** Its weekday in one letter, where a short one does not fit: "W". */
  readonly weekdayNarrow: (isoDate: string) => string;
  /** Its day of the month, with the practice's digits. */
  readonly dayOfMonth: (isoDate: string) => string;
  /** The time of an instant in the practice's zone. */
  readonly instantTime: (instant: string) => string;
  /** The weekday of an instant in the practice's zone. */
  readonly instantWeekday: (instant: string) => string;
  /** The ISO date of an instant in the practice's zone. */
  readonly instantDate: (instant: string) => string;
  /** The hour of an instant on the practice's clock, 0 to 23, for calculating. */
  readonly instantHour: (instant: string) => number;
  readonly number: (value: number) => string;
  /** Language codes as one sentence part: "Arabic and English". */
  readonly languages: (codes: readonly string[]) => string;
}

/** 2024-01-01 was a Monday, so day N of that month is ISO weekday N. */
const FIRST_MONDAY_YEAR = 2024;

function utcDate(isoDate: string): Date {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function utcClock(wallClock: string): Date {
  const [hours = 0, minutes = 0] = wallClock.split(':').map(Number);
  return new Date(Date.UTC(2000, 0, 1, hours, minutes));
}

/** A code that is no language must not take the page of a practice down: it reads as written. */
function languageName(names: Intl.DisplayNames, code: string): string {
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Every date, time and number of a practice page goes through here, with the practice's digits,
 * hour cycle and zone. Pure: nothing reads the system clock or the zone of the server.
 */
export function practiceFormat(locale: string, settings: PracticeFormatSettings): PracticeFormat {
  const { numberingSystem, hourCycle, timeZone } = settings;
  const formatting = toFormattingLocale(locale, { numberingSystem, hourCycle });
  const hour = hourCycle === 'h12' ? 'numeric' : '2-digit';
  const inZone = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat =>
    new Intl.DateTimeFormat(formatting, { ...options, timeZone });
  const inUtc = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat =>
    new Intl.DateTimeFormat(formatting, { ...options, timeZone: 'UTC' });
  // The calendar date in the zone, whatever the language: en-CA writes YYYY-MM-DD.
  const isoDateInZone = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short', timeZone });
  const hourInZone = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone,
  });
  return {
    clock: (wallClock) => inUtc({ hour, minute: '2-digit' }).format(utcClock(wallClock)),
    weekday: (isoWeekday) =>
      inUtc({ weekday: 'long' }).format(new Date(Date.UTC(FIRST_MONDAY_YEAR, 0, isoWeekday))),
    day: (isoDate) =>
      inUtc({ weekday: 'short', day: 'numeric', month: 'short' }).format(utcDate(isoDate)),
    year: (isoDate) => inUtc({ year: 'numeric' }).format(utcDate(isoDate)),
    dayLong: (isoDate) =>
      inUtc({ weekday: 'long', day: 'numeric', month: 'long' }).format(utcDate(isoDate)),
    dayLongWithYear: (isoDate) =>
      inUtc({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
        utcDate(isoDate),
      ),
    calendarDate: (isoDate) =>
      inUtc({ day: 'numeric', month: 'long', year: 'numeric' }).format(utcDate(isoDate)),
    monthYear: (isoDate) => inUtc({ month: 'long', year: 'numeric' }).format(utcDate(isoDate)),
    weekdayShort: (isoDate) => inUtc({ weekday: 'short' }).format(utcDate(isoDate)),
    weekdayNarrow: (isoDate) => inUtc({ weekday: 'narrow' }).format(utcDate(isoDate)),
    dayOfMonth: (isoDate) => inUtc({ day: 'numeric' }).format(utcDate(isoDate)),
    instantTime: (instant) => inZone({ hour, minute: '2-digit' }).format(new Date(instant)),
    instantWeekday: (instant) => inZone({ weekday: 'long' }).format(new Date(instant)),
    instantDate: (instant) => isoDateInZone.format(new Date(instant)),
    instantHour: (instant) => Number(hourInZone.format(new Date(instant))),
    number: (value) => new Intl.NumberFormat(formatting).format(value),
    languages: (codes) => {
      const names = new Intl.DisplayNames([locale], { type: 'language' });
      return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
        codes.map((code) => languageName(names, code)),
      );
    },
  };
}

/** The name of a language in that language: what a language switch offers. */
export function ownLanguageName(code: string): string {
  return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
}

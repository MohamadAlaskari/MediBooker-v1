import { isoWeekdayOf } from '../../practice-page/practice-view';

/**
 * What the free-times picker calculates, without React. Dates are ISO strings of the practice, in
 * plain calendar arithmetic: not every browser has Temporal yet.
 */

const DAYS_IN_WEEK = 7;
const NOON = 12;

export function addDays(isoDate: string, days: number): string {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The weeks from today's to the one of `last`, each from the practice's first weekday on. */
export function weeksFrom(
  today: string,
  weekStart: number,
  last: string,
): readonly (readonly string[])[] {
  const weeks: string[][] = [];
  const offset = (isoWeekdayOf(today) - weekStart + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  for (let start = addDays(today, -offset); start <= last; start = addDays(start, DAYS_IN_WEEK)) {
    weeks.push(Array.from({ length: DAYS_IN_WEEK }, (_, day) => addDays(start, day)));
  }
  return weeks;
}

export interface AvailabilityDay {
  readonly date: string;
  readonly hasFreeTimes: boolean;
}

/** The day a visitor chose while it still has free times, otherwise the first that has. */
export function selectedDay(
  days: readonly AvailabilityDay[],
  chosen: string | undefined,
): string | undefined {
  const free = days.filter(({ hasFreeTimes }) => hasFreeTimes).map(({ date }) => date);
  return chosen !== undefined && free.includes(chosen) ? chosen : free[0];
}

export interface PartsOfDay<T> {
  readonly morning: readonly T[];
  readonly afternoon: readonly T[];
}

/** Before noon on the practice's clock, or after. */
export function partsOfDay<T>(times: readonly T[], hourOf: (time: T) => number): PartsOfDay<T> {
  return {
    morning: times.filter((time) => hourOf(time) < NOON),
    afternoon: times.filter((time) => hourOf(time) >= NOON),
  };
}

/** Where an arrow key leads in a row, in reading direction; undefined for any other key. */
export function nextRovingIndex(
  current: number,
  key: string,
  count: number,
  direction: 'ltr' | 'rtl',
): number | undefined {
  const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const backward = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
  if (key === forward || key === 'ArrowDown') return Math.min(current + 1, count - 1);
  if (key === backward || key === 'ArrowUp') return Math.max(current - 1, 0);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return undefined;
}

/**
 * The booking page of a practice, where a signed-in person chooses a time and books it (B07). The
 * proxy sends a visitor without a sign-in to signing in first, and back.
 */
export function bookHref(locale: string, slug: string): string {
  return `/${locale}/book/${slug}`;
}

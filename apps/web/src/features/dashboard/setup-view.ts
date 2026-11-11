import type { OpeningIntervalDto } from '@medibooker/api-client';

/**
 * Every answer of this practice in the generated client's query keys: a change of its setup also
 * changes what its desk lists (a service in the filters, W7's free times).
 */
export function isPracticeQueryOf(practiceId: string, queryKey: readonly unknown[]): boolean {
  const practice = `/api/v1/practices/${practiceId}/`;
  return queryKey.some((part) => typeof part === 'string' && part.startsWith(practice));
}

/** The name of a language in itself, as the tabs of W13 show it: "English", "العربية". */
export function languageName(locale: string): string {
  return new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
}

/** The days of the week from the practice's first day (ISO weekdays, 1 Monday to 7 Sunday). */
export function weekdaysFrom(weekStart: number): readonly number[] {
  return Array.from({ length: 7 }, (_, offset) => ((weekStart - 1 + offset) % 7) + 1);
}

export interface OpeningRange {
  readonly opensAt: string;
  readonly closesAt: string;
}

/** Days in a row with the same hours, as W20 shows them: "Sunday – Thursday 08:00–16:00". */
export interface WeekLine {
  readonly first: number;
  readonly last: number;
  /** Empty: closed. */
  readonly ranges: readonly OpeningRange[];
}

function rangesOn(weekday: number, intervals: readonly OpeningIntervalDto[]): OpeningRange[] {
  return intervals
    .filter((interval) => interval.weekday === weekday)
    .map(({ opensAt, closesAt }) => ({ opensAt, closesAt }))
    .toSorted((a, b) => a.opensAt.localeCompare(b.opensAt));
}

function sameRanges(a: readonly OpeningRange[], b: readonly OpeningRange[]): boolean {
  return (
    a.length === b.length &&
    a.every((range, index) => {
      const other = b[index];
      return other?.opensAt === range.opensAt && other.closesAt === range.closesAt;
    })
  );
}

/** The week from its first day, days in a row with the same hours joined into one line. */
export function weekLinesOf(
  intervals: readonly OpeningIntervalDto[],
  weekStart: number,
): readonly WeekLine[] {
  const lines: WeekLine[] = [];
  for (const weekday of weekdaysFrom(weekStart)) {
    const ranges = rangesOn(weekday, intervals);
    const previous = lines.at(-1);
    if (previous !== undefined && sameRanges(previous.ranges, ranges)) {
      lines[lines.length - 1] = { ...previous, last: weekday };
    } else {
      lines.push({ first: weekday, last: weekday, ranges });
    }
  }
  return lines;
}

/** An interval as the editor holds it, with a key of its own for React and for errors. */
export interface DraftRange extends OpeningRange {
  readonly key: string;
}

export type WeekDraft = Readonly<Record<number, readonly DraftRange[]>>;

/**
 * A time field cannot hold 24:00, so the editor shows the end of the day as 00:00 and the API
 * reads it back as 24:00: a day never closes at its own start.
 */
const END_OF_DAY = '24:00';
const MIDNIGHT = '00:00';

/** The week as the editor starts it, every day with its ranges in order. */
export function draftOf(
  intervals: readonly OpeningIntervalDto[],
  nextKey: () => string,
): WeekDraft {
  const draft: Record<number, DraftRange[]> = {};
  for (const weekday of weekdaysFrom(1)) {
    draft[weekday] = rangesOn(weekday, intervals).map(({ opensAt, closesAt }) => ({
      key: nextKey(),
      opensAt,
      closesAt: closesAt === END_OF_DAY ? MIDNIGHT : closesAt,
    }));
  }
  return draft;
}

/** What the editor sends, in the order of the week, and which range each interval came from. */
export function intervalsOfDraft(
  draft: WeekDraft,
  weekStart: number,
): { readonly intervals: OpeningIntervalDto[]; readonly keys: string[] } {
  const intervals: OpeningIntervalDto[] = [];
  const keys: string[] = [];
  for (const weekday of weekdaysFrom(weekStart)) {
    for (const { key, opensAt, closesAt } of draft[weekday] ?? []) {
      intervals.push({
        weekday,
        opensAt,
        closesAt: closesAt === MIDNIGHT ? END_OF_DAY : closesAt,
      });
      keys.push(key);
    }
  }
  return { intervals, keys };
}

export type RangeProblem = 'missingTime' | 'closesBeforeOpens';

/** What the editor can tell before it asks the API: an overlap is the API's to find. */
export function problemOf({ opensAt, closesAt }: OpeningRange): RangeProblem | undefined {
  if (opensAt === '' || closesAt === '') return 'missingTime';
  if (closesAt !== MIDNIGHT && closesAt <= opensAt) return 'closesBeforeOpens';
  return undefined;
}

/** The next hours of a day: after its last range, or the usual morning. */
export function nextRangeOf(ranges: readonly OpeningRange[]): OpeningRange {
  const last = ranges.at(-1);
  if (last === undefined) return { opensAt: '08:00', closesAt: '16:00' };
  if (last.closesAt === MIDNIGHT || last.closesAt >= '22:00') return { opensAt: '', closesAt: '' };
  const [hours = 0, minutes = 0] = last.closesAt.split(':').map(Number);
  const opens = Math.min(hours + 1, 22);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return {
    opensAt: `${pad(opens)}:${pad(minutes)}`,
    closesAt: `${pad(Math.min(opens + 4, 23))}:00`,
  };
}

/** The durations W13 offers, with the service's own when it is another. */
const DURATIONS = [
  5, 10, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 120, 150, 180, 240, 300, 360, 480,
];

export function durationsWith(current: number): readonly number[] {
  return DURATIONS.includes(current)
    ? DURATIONS
    : [...DURATIONS, current].toSorted((a, b) => a - b);
}

/** The buffers W13 offers after a service (BR-27), none first, with the service's own. */
const BUFFERS = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120];

export function buffersWith(current: number): readonly number[] {
  return BUFFERS.includes(current) ? BUFFERS : [...BUFFERS, current].toSorted((a, b) => a - b);
}

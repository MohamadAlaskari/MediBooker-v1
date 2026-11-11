import type { FieldErrorCode } from '../../../common/errors/field-error-codes.js';

/**
 * A doctor's working hours and absences as the team enters them (M04, W14, BR-06). Pure: times are
 * local wall-clock times of the practice, absences become instants in its zone here.
 */

export interface FieldProblem {
  readonly field: string;
  readonly code: FieldErrorCode;
}

export interface Checked<T> {
  readonly problems: readonly FieldProblem[];
  readonly value: T;
}

/** A local wall-clock time; 24:00 is the end of the day. */
export const CLOCK_PATTERN = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;
const END_OF_DAY = 24 * 60;
/**
 * The most start times of a doctor on one day: every 5 minutes for 12 hours, every 10 for a whole
 * day. More is no working day, and each start time is a row on every such day up to the booking
 * horizon (security review of M04).
 */
export const MAX_STARTS_PER_DAY = 144;
/** The longest absence one entry covers: a year, as vacations and parental leave go. */
export const ABSENCE_MAX_DAYS = 366;

/** Minutes after local midnight of a time of `CLOCK_PATTERN`. */
export function minutesOf(clock: string): number {
  const [hours = '0', minutes = '0'] = clock.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** One interval of a doctor's week as the team enters it. */
export interface WorkingInterval {
  readonly weekday: number;
  readonly startsAt: string;
  readonly endsAt: string;
}

/** The same in minutes, as a rule keeps it. */
export interface WorkingRange {
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * The week of a doctor: each interval starts before the day ends, ends after it starts, holds at
 * least one start time and overlaps no earlier interval of its day (the later one is named, as the
 * opening hours' EXCLUDE does; rules have no constraint of their own, because slots have one).
 */
export function workingWeekOf(
  intervals: readonly WorkingInterval[],
  slotMinutes: number,
): Checked<readonly WorkingRange[]> {
  const problems: FieldProblem[] = [];
  const value = intervals.map(({ weekday, startsAt, endsAt }) => ({
    weekday,
    startMinute: minutesOf(startsAt),
    endMinute: minutesOf(endsAt),
  }));
  const starts = new Map<number, number>();
  value.forEach((range, index) => {
    const field = `intervals[${String(index)}]`;
    if (range.startMinute === END_OF_DAY) {
      problems.push({ field: `${field}.startsAt`, code: 'INVALID_VALUE' });
    } else if (range.endMinute <= range.startMinute) {
      problems.push({ field: `${field}.endsAt`, code: 'TOO_SMALL' });
    } else if (range.endMinute - range.startMinute < slotMinutes) {
      problems.push({ field, code: 'TOO_SMALL' });
    } else if (
      value
        .slice(0, index)
        .some(
          (earlier) =>
            earlier.weekday === range.weekday &&
            earlier.startMinute < range.endMinute &&
            range.startMinute < earlier.endMinute,
        )
    ) {
      problems.push({ field, code: 'OVERLAPS_EXISTING' });
    } else {
      const day =
        (starts.get(range.weekday) ?? 0) +
        Math.floor((range.endMinute - range.startMinute) / slotMinutes);
      starts.set(range.weekday, day);
      if (day > MAX_STARTS_PER_DAY) problems.push({ field, code: 'TOO_LARGE' });
    }
  });
  return { problems, value };
}

/** An absence as the team enters it: whole days, or a time of one day. */
export interface AbsenceInput {
  readonly startDate: Temporal.PlainDate;
  readonly endDate: Temporal.PlainDate;
  readonly startTime?: string | undefined;
  readonly endTime?: string | undefined;
}

export interface AbsencePeriod {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
}

function instantAt(date: Temporal.PlainDate, minute: number, timeZone: string): Temporal.Instant {
  if (minute === END_OF_DAY) {
    return date.add({ days: 1 }).toZonedDateTime({ timeZone }).toInstant();
  }
  const time = new Temporal.PlainTime(Math.floor(minute / 60), minute % 60);
  // A time that a change of the clock skips is taken at the change, as the zone says.
  return date.toZonedDateTime({ timeZone, plainTime: time }).toInstant();
}

/**
 * The instants of an absence in the practice's zone: whole days from the start of the first to the
 * start of the day after the last, or a time of one day. An absence that is over is refused, and
 * one entry covers at most a year.
 */
export function absencePeriodOf(
  { startDate, endDate, startTime, endTime }: AbsenceInput,
  timeZone: string,
  now: Temporal.Instant,
): Checked<AbsencePeriod | undefined> {
  const problems: FieldProblem[] = [];
  if (Temporal.PlainDate.compare(endDate, startDate) < 0) {
    problems.push({ field: 'endDate', code: 'TOO_SMALL' });
  } else if (startDate.until(endDate).days >= ABSENCE_MAX_DAYS) {
    problems.push({ field: 'endDate', code: 'TOO_LARGE' });
  }
  const timed = startTime !== undefined || endTime !== undefined;
  if (timed) {
    if (startTime === undefined) problems.push({ field: 'startTime', code: 'REQUIRED' });
    if (endTime === undefined) problems.push({ field: 'endTime', code: 'REQUIRED' });
    if (!startDate.equals(endDate)) problems.push({ field: 'endDate', code: 'INVALID_VALUE' });
  }
  if (problems.length > 0) return { problems, value: undefined };
  let period: AbsencePeriod;
  if (startTime !== undefined && endTime !== undefined) {
    const from = minutesOf(startTime);
    const to = minutesOf(endTime);
    if (from === END_OF_DAY) problems.push({ field: 'startTime', code: 'INVALID_VALUE' });
    else if (to <= from) problems.push({ field: 'endTime', code: 'TOO_SMALL' });
    if (problems.length > 0) return { problems, value: undefined };
    period = {
      startsAt: instantAt(startDate, from, timeZone),
      endsAt: instantAt(startDate, to, timeZone),
    };
  } else {
    period = {
      startsAt: instantAt(startDate, 0, timeZone),
      endsAt: instantAt(endDate, END_OF_DAY, timeZone),
    };
  }
  if (Temporal.Instant.compare(period.endsAt, now) <= 0) {
    return { problems: [{ field: 'endDate', code: 'TOO_SMALL' }], value: undefined };
  }
  return { problems: [], value: period };
}

/** Whether an absence covers whole days of the practice, for how a list writes it. */
export function isAllDay(period: AbsencePeriod, timeZone: string): boolean {
  const start = period.startsAt.toZonedDateTimeISO(timeZone);
  const end = period.endsAt.toZonedDateTimeISO(timeZone);
  return (
    start.equals(start.startOfDay()) &&
    end.equals(end.startOfDay()) &&
    Temporal.Instant.compare(period.startsAt, period.endsAt) < 0
  );
}

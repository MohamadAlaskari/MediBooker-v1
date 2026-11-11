import type { DeskAbsenceDto, DeskWeekDto, DeskWeekSlotDto } from '@medibooker/api-client';
import type { PracticeFormat } from '@/lib/format';
import { nextDay } from './desk-view';

const WEEK_DAYS = 7;

/** What a cell of the calendar shows: a time of the doctor, an absence, or nothing. */
export type CalendarCell =
  | { readonly kind: 'slot'; readonly slot: DeskWeekSlotDto }
  | { readonly kind: 'absence'; readonly reason: DeskAbsenceDto['reason'] }
  | { readonly kind: 'empty' };

export interface CalendarRow {
  /** The wall-clock time of the row in the practice's zone, as `09:30`. */
  readonly time: string;
  /** The start of a slot of the row, to show the time with the practice's digits. */
  readonly startsAt: string;
  readonly cells: readonly CalendarCell[];
}

export interface CalendarGrid {
  /** The days with a time or an absence of the doctor: a closed day has no column. */
  readonly days: readonly string[];
  readonly rows: readonly CalendarRow[];
}

type Clock = Pick<PracticeFormat, 'instantDate' | 'instantClock'>;

/** Whether an absence covers a day's time; ISO dates and `09:30` compare as text. */
function covers(absence: DeskAbsenceDto, day: string, time: string, clock: Clock): boolean {
  const startDay = clock.instantDate(absence.startsAt);
  const startTime = clock.instantClock(absence.startsAt);
  const endDay = clock.instantDate(absence.endsAt);
  const endTime = clock.instantClock(absence.endsAt);
  const started = day > startDay || (day === startDay && time >= startTime);
  const ended = day > endDay || (day === endDay && time >= endTime);
  return started && !ended;
}

/**
 * W2's grid: a row per start time of the week, a column per day the doctor works or is away, and in
 * each cell the slot of that day and time, else an absence that covers it, else nothing.
 */
export function calendarGrid(week: DeskWeekDto, clock: Clock): CalendarGrid {
  const allDays = Array.from({ length: WEEK_DAYS }, (_, offset) => nextDay(week.from, offset));
  const slots = week.slots.map((slot) => ({
    slot,
    day: clock.instantDate(slot.startsAt),
    time: clock.instantClock(slot.startsAt),
  }));
  const times = [...new Set(slots.map(({ time }) => time))].toSorted();
  const days = allDays.filter(
    (day) =>
      slots.some((entry) => entry.day === day) ||
      week.absences.some((absence) =>
        // An absence of the day, at any of the week's times or across the whole day.
        [...times, '00:00'].some((time) => covers(absence, day, time, clock)),
      ),
  );
  const rows = times.map((time): CalendarRow => {
    const first = slots.find((entry) => entry.time === time);
    return {
      time,
      startsAt: first?.slot.startsAt ?? '',
      cells: days.map((day): CalendarCell => {
        const held = slots.find((entry) => entry.day === day && entry.time === time);
        if (held !== undefined) return { kind: 'slot', slot: held.slot };
        const away = week.absences.find((absence) => covers(absence, day, time, clock));
        return away === undefined ? { kind: 'empty' } : { kind: 'absence', reason: away.reason };
      }),
    };
  });
  return { days, rows };
}

/** How long a slot lasts, in whole minutes. */
export function minutesOf(slot: Pick<DeskWeekSlotDto, 'startsAt' | 'endsAt'>): number {
  return Math.round((Date.parse(slot.endsAt) - Date.parse(slot.startsAt)) / 60_000);
}

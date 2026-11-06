/** Hours of one day, in minutes after local midnight (at most 1440). */
export interface DayHours {
  readonly opensAt: number;
  readonly closesAt: number;
}

export interface WeeklyHours extends DayHours {
  /** ISO weekday: 1 Monday to 7 Sunday. */
  readonly weekday: number;
}

/** A date whose hours replace its weekday's: closed, or other hours. */
export interface SpecialHours {
  /** ISO date, for example 2026-11-19. */
  readonly date: string;
  readonly closed: boolean;
  readonly opensAt: number | null;
  readonly closesAt: number | null;
}

export interface PracticeSchedule {
  /** IANA zone. */
  readonly timeZone: string;
  readonly openingHours: readonly WeeklyHours[];
  readonly specialDays: readonly SpecialHours[];
}

export interface OpenNow {
  readonly openNow: boolean;
  /** When that changes; null when it does not within the horizon. */
  readonly nextChangeAt: Temporal.Instant | null;
}

/** How far ahead the next change is searched: the special days the page shows (BR-22). */
export const OPEN_NOW_HORIZON_DAYS = 60;

const MINUTES_PER_DAY = 1440;

interface OpenInterval {
  readonly start: Temporal.Instant;
  end: Temporal.Instant;
}

/**
 * A local wall-clock time as an instant. 1440 is the next midnight. A time that a DST change skips
 * moves forward and one that it repeats takes the earlier instant (Temporal's `compatible`).
 */
function instantAt(date: Temporal.PlainDate, minutes: number, timeZone: string): Temporal.Instant {
  const minuteOfDay = minutes % MINUTES_PER_DAY;
  return date
    .add({ days: Math.floor(minutes / MINUTES_PER_DAY) })
    .toZonedDateTime({
      timeZone,
      plainTime: new Temporal.PlainTime(Math.floor(minuteOfDay / 60), minuteOfDay % 60),
    })
    .toInstant();
}

/** The hours of one date: a special day replaces its weekday's hours. */
function hoursOn(
  date: Temporal.PlainDate,
  schedule: PracticeSchedule,
  specialDays: ReadonlyMap<string, SpecialHours>,
): readonly DayHours[] {
  const special = specialDays.get(date.toString());
  if (special === undefined) {
    return schedule.openingHours.filter((hours) => hours.weekday === date.dayOfWeek);
  }
  if (special.closed || special.opensAt === null || special.closesAt === null) return [];
  return [{ opensAt: special.opensAt, closesAt: special.closesAt }];
}

/** The open intervals from `today` to the horizon as instants, sorted, touching ones merged. */
function openIntervals(today: Temporal.PlainDate, schedule: PracticeSchedule): OpenInterval[] {
  const specialDays = new Map(schedule.specialDays.map((day) => [day.date, day]));
  const intervals: OpenInterval[] = [];
  for (let offset = 0; offset <= OPEN_NOW_HORIZON_DAYS; offset += 1) {
    const date = today.add({ days: offset });
    const hours = [...hoursOn(date, schedule, specialDays)].sort((a, b) => a.opensAt - b.opensAt);
    for (const { opensAt, closesAt } of hours) {
      const start = instantAt(date, opensAt, schedule.timeZone);
      const end = instantAt(date, closesAt, schedule.timeZone);
      const previous = intervals.at(-1);
      if (previous !== undefined && Temporal.Instant.compare(start, previous.end) <= 0) {
        previous.end = end;
      } else {
        intervals.push({ start, end });
      }
    }
  }
  return intervals;
}

/**
 * Whether the practice is open at `now`, and when that changes (BR-22): computed in the practice's
 * time zone from its opening hours and special days. Pure: `now` comes from the Clock.
 */
export function computeOpenNow(now: Temporal.Instant, schedule: PracticeSchedule): OpenNow {
  const today = now.toZonedDateTimeISO(schedule.timeZone).toPlainDate();
  const horizon = instantAt(
    today.add({ days: OPEN_NOW_HORIZON_DAYS }),
    MINUTES_PER_DAY,
    schedule.timeZone,
  );
  for (const { start, end } of openIntervals(today, schedule)) {
    if (Temporal.Instant.compare(now, end) >= 0) continue;
    if (Temporal.Instant.compare(now, start) < 0) return { openNow: false, nextChangeAt: start };
    // An interval that reaches the horizon may go on: its end is not a known change.
    const endsWithinHorizon = Temporal.Instant.compare(end, horizon) < 0;
    return { openNow: true, nextChangeAt: endsWithinHorizon ? end : null };
  }
  return { openNow: false, nextChangeAt: null };
}

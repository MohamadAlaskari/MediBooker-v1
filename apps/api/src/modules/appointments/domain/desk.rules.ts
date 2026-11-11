/**
 * What the practice's team can do with an appointment (BR-04, BR-11), and what a person's day is.
 * Pure: the service reads the clock and holds the locks, and the answers of the API carry what these
 * say, because the clock belongs to the API and a page must not judge a day or a start itself.
 */

export const APPOINTMENT_STATUSES = [
  'BOOKED',
  'CHECKED_IN',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
] as const;

export type AppointmentStatusName = (typeof APPOINTMENT_STATUSES)[number];

/** The changes the team makes, in the order a screen offers them. */
export const DESK_ACTIONS = ['CHECK_IN', 'COMPLETE', 'NO_SHOW', 'CANCEL'] as const;

export type DeskAction = (typeof DESK_ACTIONS)[number];

/** Where an appointment's day lies from today, both in the practice's time zone. */
export const DAY_RELATIONS = ['PAST', 'TODAY', 'FUTURE'] as const;

export type DayRelation = (typeof DAY_RELATIONS)[number];

/** The moment of a change against the appointment's time, as the service reads it. */
export interface DeskTiming {
  readonly now: Temporal.Instant;
  readonly startsAt: Temporal.Instant;
  readonly timeZone: string;
}

/** The status each change leads to. A cancel by the practice frees the slot (BR-07). */
const TARGET: Readonly<Record<DeskAction, AppointmentStatusName>> = {
  CHECK_IN: 'CHECKED_IN',
  COMPLETE: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
  CANCEL: 'CANCELLED',
};

/** The date of an instant on the practice's wall clock. */
export function dayOf(instant: Temporal.Instant, timeZone: string): Temporal.PlainDate {
  return instant.toZonedDateTimeISO(timeZone).toPlainDate();
}

export function dayRelationOf({ now, startsAt, timeZone }: DeskTiming): DayRelation {
  const order = Temporal.PlainDate.compare(dayOf(startsAt, timeZone), dayOf(now, timeZone));
  if (order < 0) return 'PAST';
  return order === 0 ? 'TODAY' : 'FUTURE';
}

/**
 * BR-11: check-in, completion and no-show only on the appointment's day, and a no-show only from its
 * start on. BR-04: the practice can always cancel a booked appointment, with a reason. Nothing leads
 * out of COMPLETED, NO_SHOW or CANCELLED, and nothing but completion out of CHECKED_IN.
 */
export function deskActionsOf(status: AppointmentStatusName, timing: DeskTiming): DeskAction[] {
  const today = dayRelationOf(timing) === 'TODAY';
  const started = Temporal.Instant.compare(timing.now, timing.startsAt) >= 0;
  if (status === 'CHECKED_IN') return today ? ['COMPLETE'] : [];
  if (status !== 'BOOKED') return [];
  return [
    ...(today ? (['CHECK_IN'] as const) : []),
    ...(today && started ? (['NO_SHOW'] as const) : []),
    'CANCEL',
  ];
}

/**
 * What a change does to an appointment in this status at this moment: `same` when it is there
 * already, so that a retry is safe and answers alike; `invalid` when it cannot be made now.
 */
export function deskChangeOf(
  action: DeskAction,
  status: AppointmentStatusName,
  timing: DeskTiming,
):
  | { readonly kind: 'apply'; readonly to: AppointmentStatusName }
  | { readonly kind: 'same' | 'invalid' } {
  const to = TARGET[action];
  if (status === to) return { kind: 'same' };
  return deskActionsOf(status, timing).includes(action)
    ? { kind: 'apply', to }
    : { kind: 'invalid' };
}

/**
 * Whole years of age on a day, as Temporal counts them: born on 29 February, a year older on 1 March
 * of other years.
 */
export function ageOn(dateOfBirth: Temporal.PlainDate, day: Temporal.PlainDate): number {
  return Math.max(0, dateOfBirth.until(day, { largestUnit: 'years' }).years);
}

import { describe, expect, it } from 'vitest';
import {
  ageOn,
  APPOINTMENT_STATUSES,
  type AppointmentStatusName,
  dayOf,
  dayRelationOf,
  type DeskAction,
  deskActionsOf,
  deskChangeOf,
  type DeskTiming,
} from './desk.rules.js';

const ZONE = 'Asia/Riyadh';
/** 10:00 in Riyadh on Sunday 15 November 2026. */
const STARTS_AT = Temporal.Instant.from('2026-11-15T07:00:00Z');

function at(now: string): DeskTiming {
  return { now: Temporal.Instant.from(now), startsAt: STARTS_AT, timeZone: ZONE };
}

/** The moments that matter, in Riyadh: the day before, the day before the start, after it, the day after. */
const TIMINGS = {
  dayBefore: at('2026-11-14T20:59:59Z'),
  beforeStart: at('2026-11-14T21:00:00Z'),
  afterStart: at('2026-11-15T07:00:00Z'),
  dayAfter: at('2026-11-15T21:00:00Z'),
} as const;

type Moment = keyof typeof TIMINGS;
type Kind = 'apply' | 'same' | 'invalid';

/**
 * The status-transition matrix of M05 (BR-04, BR-11): for each status and moment, what each change
 * of the team does. `same`: the status is there already, and a retry answers alike.
 */
const MATRIX: Readonly<
  Record<AppointmentStatusName, Readonly<Record<Moment, Readonly<Record<DeskAction, Kind>>>>>
> = {
  BOOKED: {
    dayBefore: { CHECK_IN: 'invalid', COMPLETE: 'invalid', NO_SHOW: 'invalid', CANCEL: 'apply' },
    beforeStart: { CHECK_IN: 'apply', COMPLETE: 'invalid', NO_SHOW: 'invalid', CANCEL: 'apply' },
    afterStart: { CHECK_IN: 'apply', COMPLETE: 'invalid', NO_SHOW: 'apply', CANCEL: 'apply' },
    dayAfter: { CHECK_IN: 'invalid', COMPLETE: 'invalid', NO_SHOW: 'invalid', CANCEL: 'apply' },
  },
  CHECKED_IN: {
    dayBefore: { CHECK_IN: 'same', COMPLETE: 'invalid', NO_SHOW: 'invalid', CANCEL: 'invalid' },
    beforeStart: { CHECK_IN: 'same', COMPLETE: 'apply', NO_SHOW: 'invalid', CANCEL: 'invalid' },
    afterStart: { CHECK_IN: 'same', COMPLETE: 'apply', NO_SHOW: 'invalid', CANCEL: 'invalid' },
    dayAfter: { CHECK_IN: 'same', COMPLETE: 'invalid', NO_SHOW: 'invalid', CANCEL: 'invalid' },
  },
  COMPLETED: {
    dayBefore: { CHECK_IN: 'invalid', COMPLETE: 'same', NO_SHOW: 'invalid', CANCEL: 'invalid' },
    beforeStart: { CHECK_IN: 'invalid', COMPLETE: 'same', NO_SHOW: 'invalid', CANCEL: 'invalid' },
    afterStart: { CHECK_IN: 'invalid', COMPLETE: 'same', NO_SHOW: 'invalid', CANCEL: 'invalid' },
    dayAfter: { CHECK_IN: 'invalid', COMPLETE: 'same', NO_SHOW: 'invalid', CANCEL: 'invalid' },
  },
  NO_SHOW: {
    dayBefore: { CHECK_IN: 'invalid', COMPLETE: 'invalid', NO_SHOW: 'same', CANCEL: 'invalid' },
    beforeStart: { CHECK_IN: 'invalid', COMPLETE: 'invalid', NO_SHOW: 'same', CANCEL: 'invalid' },
    afterStart: { CHECK_IN: 'invalid', COMPLETE: 'invalid', NO_SHOW: 'same', CANCEL: 'invalid' },
    dayAfter: { CHECK_IN: 'invalid', COMPLETE: 'invalid', NO_SHOW: 'same', CANCEL: 'invalid' },
  },
  CANCELLED: {
    dayBefore: { CHECK_IN: 'invalid', COMPLETE: 'invalid', NO_SHOW: 'invalid', CANCEL: 'same' },
    beforeStart: { CHECK_IN: 'invalid', COMPLETE: 'invalid', NO_SHOW: 'invalid', CANCEL: 'same' },
    afterStart: { CHECK_IN: 'invalid', COMPLETE: 'invalid', NO_SHOW: 'invalid', CANCEL: 'same' },
    dayAfter: { CHECK_IN: 'invalid', COMPLETE: 'invalid', NO_SHOW: 'invalid', CANCEL: 'same' },
  },
};

const CASES = APPOINTMENT_STATUSES.flatMap((status) =>
  (Object.keys(TIMINGS) as Moment[]).flatMap((moment) =>
    (Object.keys(MATRIX[status][moment]) as DeskAction[]).map(
      (action) => [status, moment, action, MATRIX[status][moment][action]] as const,
    ),
  ),
);

describe('the status-transition matrix (BR-04, BR-11)', () => {
  it.each(CASES)('%s at %s: %s is %s', (status, moment, action, kind) => {
    expect(deskChangeOf(action, status, TIMINGS[moment]).kind).toBe(kind);
  });

  it('names the status a change leads to', () => {
    expect(deskChangeOf('CHECK_IN', 'BOOKED', TIMINGS.beforeStart)).toEqual({
      kind: 'apply',
      to: 'CHECKED_IN',
    });
    expect(deskChangeOf('COMPLETE', 'CHECKED_IN', TIMINGS.afterStart)).toEqual({
      kind: 'apply',
      to: 'COMPLETED',
    });
    expect(deskChangeOf('NO_SHOW', 'BOOKED', TIMINGS.afterStart)).toEqual({
      kind: 'apply',
      to: 'NO_SHOW',
    });
    expect(deskChangeOf('CANCEL', 'BOOKED', TIMINGS.dayAfter)).toEqual({
      kind: 'apply',
      to: 'CANCELLED',
    });
  });

  it('offers the changes of the matrix, in the order of a screen', () => {
    expect(deskActionsOf('BOOKED', TIMINGS.afterStart)).toEqual(['CHECK_IN', 'NO_SHOW', 'CANCEL']);
    expect(deskActionsOf('BOOKED', TIMINGS.beforeStart)).toEqual(['CHECK_IN', 'CANCEL']);
    expect(deskActionsOf('BOOKED', TIMINGS.dayBefore)).toEqual(['CANCEL']);
    expect(deskActionsOf('CHECKED_IN', TIMINGS.afterStart)).toEqual(['COMPLETE']);
    expect(deskActionsOf('CHECKED_IN', TIMINGS.dayAfter)).toEqual([]);
    expect(deskActionsOf('NO_SHOW', TIMINGS.afterStart)).toEqual([]);
  });

  it('allows a no-show from the start on, not a millisecond before', () => {
    const justBefore = { ...TIMINGS.afterStart, now: STARTS_AT.subtract({ milliseconds: 1 }) };
    expect(deskChangeOf('NO_SHOW', 'BOOKED', justBefore).kind).toBe('invalid');
    expect(deskChangeOf('NO_SHOW', 'BOOKED', TIMINGS.afterStart).kind).toBe('apply');
  });
});

describe('the day of an appointment', () => {
  it('is the date on the practice wall clock', () => {
    // 21:30 UTC on the 14th is 00:30 on the 15th in Riyadh.
    expect(dayOf(Temporal.Instant.from('2026-11-14T21:30:00Z'), ZONE).toString()).toBe(
      '2026-11-15',
    );
    expect(dayOf(Temporal.Instant.from('2026-11-14T21:30:00Z'), 'UTC').toString()).toBe(
      '2026-11-14',
    );
  });

  it('lies in the past, today or the future of the practice', () => {
    expect(dayRelationOf(TIMINGS.dayBefore)).toBe('FUTURE');
    expect(dayRelationOf(TIMINGS.beforeStart)).toBe('TODAY');
    expect(dayRelationOf(TIMINGS.afterStart)).toBe('TODAY');
    expect(dayRelationOf(TIMINGS.dayAfter)).toBe('PAST');
  });

  it('keeps a day whole across a change of the clocks', () => {
    // Berlin changes to summer time on 29 March 2026: the day has 23 hours.
    const startsAt = Temporal.Instant.from('2026-03-29T21:00:00Z');
    const timing = (now: string): DeskTiming => ({
      now: Temporal.Instant.from(now),
      startsAt,
      timeZone: 'Europe/Berlin',
    });
    expect(dayRelationOf(timing('2026-03-28T23:00:00Z'))).toBe('TODAY');
    expect(dayRelationOf(timing('2026-03-28T22:59:59Z'))).toBe('FUTURE');
    expect(dayRelationOf(timing('2026-03-29T22:00:00Z'))).toBe('PAST');
  });
});

describe('ageOn', () => {
  const day = Temporal.PlainDate.from('2026-11-15');

  it('counts whole years', () => {
    expect(ageOn(Temporal.PlainDate.from('1990-11-15'), day)).toBe(36);
    expect(ageOn(Temporal.PlainDate.from('1990-11-16'), day)).toBe(35);
  });

  it('counts a birthday on 29 February on 1 March of other years, as Temporal does', () => {
    const leapDay = Temporal.PlainDate.from('2000-02-29');
    expect(ageOn(leapDay, Temporal.PlainDate.from('2001-02-28'))).toBe(0);
    expect(ageOn(leapDay, Temporal.PlainDate.from('2001-03-01'))).toBe(1);
    expect(ageOn(leapDay, Temporal.PlainDate.from('2004-02-29'))).toBe(4);
  });

  it('is never below zero, also for a date of birth after the day', () => {
    expect(ageOn(Temporal.PlainDate.from('2027-01-01'), day)).toBe(0);
  });
});

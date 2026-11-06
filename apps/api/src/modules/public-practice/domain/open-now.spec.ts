import { describe, expect, it } from 'vitest';
import { computeOpenNow, type PracticeSchedule } from './open-now.js';

/** Sunday to Thursday, 09:00 to 13:00 and 16:00 to 20:00; closed on 2026-11-19. */
const RIYADH: PracticeSchedule = {
  timeZone: 'Asia/Riyadh',
  openingHours: [7, 1, 2, 3, 4].flatMap((weekday) => [
    { weekday, opensAt: 540, closesAt: 780 },
    { weekday, opensAt: 960, closesAt: 1200 },
  ]),
  specialDays: [{ date: '2026-11-19', closed: true, opensAt: null, closesAt: null }],
};

/** Monday to Friday, 08:00 to 18:00. */
const BERLIN: PracticeSchedule = {
  timeZone: 'Europe/Berlin',
  openingHours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: 480, closesAt: 1080 })),
  specialDays: [],
};

function openNowAt(instant: string, schedule: PracticeSchedule) {
  const { openNow, nextChangeAt } = computeOpenNow(Temporal.Instant.from(instant), schedule);
  return { openNow, nextChangeAt: nextChangeAt?.toString() ?? null };
}

describe('computeOpenNow (BR-22)', () => {
  it('is open inside an interval and names its end', () => {
    // Sunday 2026-11-15, 10:00 in Riyadh.
    expect(openNowAt('2026-11-15T07:00:00Z', RIYADH)).toEqual({
      openNow: true,
      nextChangeAt: '2026-11-15T10:00:00Z',
    });
  });

  it('is closed in the midday break and names the next opening', () => {
    // Sunday 14:00 in Riyadh.
    expect(openNowAt('2026-11-15T11:00:00Z', RIYADH)).toEqual({
      openNow: false,
      nextChangeAt: '2026-11-15T13:00:00Z',
    });
  });

  it('treats the opening minute as open and the closing minute as closed', () => {
    expect(openNowAt('2026-11-15T06:00:00Z', RIYADH).openNow).toBe(true);
    expect(openNowAt('2026-11-15T10:00:00Z', RIYADH).openNow).toBe(false);
  });

  it('is closed on a Riyadh Friday and opens again on Sunday', () => {
    // Friday 2026-11-13, 10:00 in Riyadh: the weekly hours have no Friday and no Saturday.
    expect(openNowAt('2026-11-13T07:00:00Z', RIYADH)).toEqual({
      openNow: false,
      nextChangeAt: '2026-11-15T06:00:00Z',
    });
  });

  it('is closed on the 2026-11-19 closure, a Thursday with weekly hours', () => {
    expect(openNowAt('2026-11-19T07:00:00Z', RIYADH)).toEqual({
      openNow: false,
      nextChangeAt: '2026-11-22T06:00:00Z',
    });
  });

  it('uses the other hours of a special day instead of the weekday', () => {
    const schedule: PracticeSchedule = {
      ...BERLIN,
      specialDays: [{ date: '2026-12-24', closed: false, opensAt: 480, closesAt: 720 }],
    };
    // Thursday 2026-12-24, 13:00 in Berlin: on a normal Thursday it would be open until 18:00.
    expect(openNowAt('2026-12-24T12:00:00Z', schedule)).toEqual({
      openNow: false,
      nextChangeAt: '2026-12-25T07:00:00Z',
    });
  });

  it('follows a Berlin evening across the DST change on 2027-03-28', () => {
    // Friday 2027-03-26, 19:00 CET: closed until Monday 08:00, which is CEST (UTC+2).
    expect(openNowAt('2027-03-26T18:00:00Z', BERLIN)).toEqual({
      openNow: false,
      nextChangeAt: '2027-03-29T06:00:00Z',
    });
    // Monday 2027-03-29, 17:30 CEST: open until 18:00 CEST.
    expect(openNowAt('2027-03-29T15:30:00Z', BERLIN)).toEqual({
      openNow: true,
      nextChangeAt: '2027-03-29T16:00:00Z',
    });
  });

  it('moves a time that the DST change skips forward', () => {
    const schedule: PracticeSchedule = {
      timeZone: 'Europe/Berlin',
      openingHours: [{ weekday: 7, opensAt: 150, closesAt: 600 }],
      specialDays: [],
    };
    // Sunday 2027-03-28: 02:30 does not exist, so it opens at 03:30 CEST.
    expect(openNowAt('2027-03-28T00:00:00Z', schedule)).toEqual({
      openNow: false,
      nextChangeAt: '2027-03-28T01:30:00Z',
    });
  });

  it('merges intervals that touch, also across midnight', () => {
    const schedule: PracticeSchedule = {
      timeZone: 'UTC',
      openingHours: [
        { weekday: 1, opensAt: 480, closesAt: 720 },
        { weekday: 1, opensAt: 720, closesAt: 1440 },
        { weekday: 2, opensAt: 0, closesAt: 60 },
      ],
      specialDays: [],
    };
    // Monday 2026-11-16, 09:00: open without a break until Tuesday 01:00.
    expect(openNowAt('2026-11-16T09:00:00Z', schedule)).toEqual({
      openNow: true,
      nextChangeAt: '2026-11-17T01:00:00Z',
    });
  });

  it('names no change for a practice that stays open beyond the horizon', () => {
    const schedule: PracticeSchedule = {
      timeZone: 'UTC',
      openingHours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday,
        opensAt: 0,
        closesAt: 1440,
      })),
      specialDays: [],
    };
    expect(openNowAt('2026-11-16T09:00:00Z', schedule)).toEqual({
      openNow: true,
      nextChangeAt: null,
    });
  });

  it('names no change for a practice without any hours', () => {
    expect(
      openNowAt('2026-11-16T09:00:00Z', { timeZone: 'UTC', openingHours: [], specialDays: [] }),
    ).toEqual({ openNow: false, nextChangeAt: null });
  });
});

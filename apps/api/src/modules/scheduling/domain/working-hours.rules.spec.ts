import { describe, expect, it } from 'vitest';
import {
  absencePeriodOf,
  isAllDay,
  MAX_STARTS_PER_DAY,
  minutesOf,
  workingWeekOf,
} from './working-hours.rules.js';

const RIYADH = 'Asia/Riyadh';
const BERLIN = 'Europe/Berlin';
/** 10:00 in Riyadh on Sunday 15 November 2026. */
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const date = (text: string): Temporal.PlainDate => Temporal.PlainDate.from(text);

describe('workingWeekOf', () => {
  it('turns the week into minutes, 24:00 being the end of the day', () => {
    expect(minutesOf('16:30')).toBe(990);
    expect(
      workingWeekOf(
        [
          { weekday: 7, startsAt: '08:00', endsAt: '12:00' },
          { weekday: 7, startsAt: '13:00', endsAt: '24:00' },
        ],
        15,
      ),
    ).toEqual({
      problems: [],
      value: [
        { weekday: 7, startMinute: 480, endMinute: 720 },
        { weekday: 7, startMinute: 780, endMinute: 1440 },
      ],
    });
  });

  it('names an interval that ends before it starts, holds no start time, or overlaps an earlier one', () => {
    const { problems } = workingWeekOf(
      [
        { weekday: 1, startsAt: '08:00', endsAt: '12:00' },
        { weekday: 1, startsAt: '11:30', endsAt: '14:00' },
        { weekday: 2, startsAt: '11:30', endsAt: '14:00' },
        { weekday: 3, startsAt: '10:00', endsAt: '10:00' },
        { weekday: 4, startsAt: '10:00', endsAt: '10:10' },
        { weekday: 5, startsAt: '24:00', endsAt: '24:00' },
      ],
      15,
    );
    expect(problems).toEqual([
      { field: 'intervals[1]', code: 'OVERLAPS_EXISTING' },
      { field: 'intervals[3].endsAt', code: 'TOO_SMALL' },
      { field: 'intervals[4]', code: 'TOO_SMALL' },
      { field: 'intervals[5].startsAt', code: 'INVALID_VALUE' },
    ]);
  });

  it('names the interval that takes a day past the most start times', () => {
    // Every 5 minutes from 06:00 to 18:00 is 144 start times; five more minutes are one too many.
    const { problems } = workingWeekOf(
      [
        { weekday: 1, startsAt: '06:00', endsAt: '12:00' },
        { weekday: 1, startsAt: '12:00', endsAt: '18:00' },
        { weekday: 2, startsAt: '06:00', endsAt: '18:05' },
        { weekday: 3, startsAt: '00:00', endsAt: '24:00' },
      ],
      5,
    );
    expect(MAX_STARTS_PER_DAY).toBe(144);
    expect(problems).toEqual([
      { field: 'intervals[2]', code: 'TOO_LARGE' },
      { field: 'intervals[3]', code: 'TOO_LARGE' },
    ]);
    expect(
      workingWeekOf([{ weekday: 3, startsAt: '00:00', endsAt: '24:00' }], 10).problems,
    ).toEqual([]);
  });
});

describe('absencePeriodOf', () => {
  it('takes whole days from the start of the first to the start of the day after the last', () => {
    const { problems, value } = absencePeriodOf(
      { startDate: date('2026-11-19'), endDate: date('2026-11-20') },
      RIYADH,
      NOW,
    );
    expect(problems).toEqual([]);
    expect(value).toEqual({
      startsAt: Temporal.Instant.from('2026-11-18T21:00:00Z'),
      endsAt: Temporal.Instant.from('2026-11-20T21:00:00Z'),
    });
    expect(value === undefined ? false : isAllDay(value, RIYADH)).toBe(true);
  });

  it('takes a time of one day, also over a change of the clock', () => {
    const { value } = absencePeriodOf(
      {
        startDate: date('2027-03-28'),
        endDate: date('2027-03-28'),
        startTime: '01:00',
        endTime: '24:00',
      },
      BERLIN,
      NOW,
    );
    // Berlin goes from 02:00 to 03:00 on 28 March 2027: the day has 23 hours.
    expect(value).toEqual({
      startsAt: Temporal.Instant.from('2027-03-28T00:00:00Z'),
      endsAt: Temporal.Instant.from('2027-03-28T22:00:00Z'),
    });
    expect(value === undefined ? true : isAllDay(value, BERLIN)).toBe(false);
  });

  it('refuses an end before the start, more than a year, and times across days', () => {
    expect(
      absencePeriodOf({ startDate: date('2026-11-20'), endDate: date('2026-11-19') }, RIYADH, NOW)
        .problems,
    ).toEqual([{ field: 'endDate', code: 'TOO_SMALL' }]);
    expect(
      absencePeriodOf({ startDate: date('2026-11-20'), endDate: date('2027-11-21') }, RIYADH, NOW)
        .problems,
    ).toEqual([{ field: 'endDate', code: 'TOO_LARGE' }]);
    expect(
      absencePeriodOf(
        { startDate: date('2026-11-20'), endDate: date('2026-11-21'), startTime: '08:00' },
        RIYADH,
        NOW,
      ).problems,
    ).toEqual([
      { field: 'endTime', code: 'REQUIRED' },
      { field: 'endDate', code: 'INVALID_VALUE' },
    ]);
    expect(
      absencePeriodOf(
        { startDate: date('2026-11-20'), endDate: date('2026-11-20'), endTime: '08:00' },
        RIYADH,
        NOW,
      ).problems,
    ).toEqual([{ field: 'startTime', code: 'REQUIRED' }]);
  });

  it('refuses times that end before they start, start at the end of the day, or are over', () => {
    const day = { startDate: date('2026-11-20'), endDate: date('2026-11-20') };
    expect(
      absencePeriodOf({ ...day, startTime: '12:00', endTime: '08:00' }, RIYADH, NOW).problems,
    ).toEqual([{ field: 'endTime', code: 'TOO_SMALL' }]);
    expect(
      absencePeriodOf({ ...day, startTime: '24:00', endTime: '24:00' }, RIYADH, NOW).problems,
    ).toEqual([{ field: 'startTime', code: 'INVALID_VALUE' }]);
    // This morning in Riyadh is over at 10:00.
    expect(
      absencePeriodOf(
        {
          startDate: date('2026-11-15'),
          endDate: date('2026-11-15'),
          startTime: '08:00',
          endTime: '09:00',
        },
        RIYADH,
        NOW,
      ).problems,
    ).toEqual([{ field: 'endDate', code: 'TOO_SMALL' }]);
    // Today as a whole day is not over yet.
    expect(
      absencePeriodOf({ startDate: date('2026-11-15'), endDate: date('2026-11-15') }, RIYADH, NOW)
        .problems,
    ).toEqual([]);
  });
});

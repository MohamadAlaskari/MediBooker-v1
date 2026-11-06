import { describe, expect, it } from 'vitest';
import {
  bookableWindow,
  dayRange,
  daysInRange,
  daysWithFreeTimes,
  generateSlots,
  type SlotGenerationInput,
  type SlotRule,
} from './slots.rules.js';

const date = (text: string): Temporal.PlainDate => Temporal.PlainDate.from(text);
const instant = (text: string): Temporal.Instant => Temporal.Instant.from(text);

const RULE: SlotRule = {
  id: 'rule',
  providerId: 'provider',
  weekday: 1,
  startMinute: 480,
  endMinute: 510,
  slotMinutes: 30,
  validFrom: date('2020-01-01'),
  validTo: null,
};

const INPUT: SlotGenerationInput = {
  rules: [RULE],
  absences: [],
  closedDays: new Set(),
  weekendDays: [],
  timeZone: 'Europe/Berlin',
  from: date('2027-03-22'),
  to: date('2027-03-22'),
};

const startsOf = (input: Partial<SlotGenerationInput>): string[] =>
  generateSlots({ ...INPUT, ...input }).map(({ startsAt }) => startsAt.toString());

describe('generateSlots (BR-15 fixtures of 06 §3)', () => {
  it('BR-15 keeps a weekly Monday 08:00 at 08:00 local across both clock changes in Berlin', () => {
    expect(startsOf({ from: date('2027-03-22'), to: date('2027-03-29') })).toEqual([
      '2027-03-22T07:00:00Z',
      '2027-03-29T06:00:00Z',
    ]);
    expect(startsOf({ from: date('2027-10-25'), to: date('2027-11-01') })).toEqual([
      '2027-10-25T06:00:00Z',
      '2027-11-01T07:00:00Z',
    ]);
  });

  const sunday: SlotRule = { ...RULE, weekday: 7, startMinute: 60, endMinute: 240 };

  it('BR-15 skips the local times that do not exist on the spring change', () => {
    const day = date('2027-03-28');
    expect(startsOf({ rules: [sunday], from: day, to: day })).toEqual([
      '2027-03-28T00:00:00Z', // 01:00 CET
      '2027-03-28T00:30:00Z', // 01:30 CET; 02:00 and 02:30 do not exist
      '2027-03-28T01:00:00Z', // 03:00 CEST
      '2027-03-28T01:30:00Z', // 03:30 CEST
    ]);
  });

  it('BR-15 gives a local time that occurs twice one slot, at its earlier instant', () => {
    const day = date('2027-10-31');
    expect(startsOf({ rules: [sunday], from: day, to: day })).toEqual([
      '2027-10-30T23:00:00Z', // 01:00 CEST
      '2027-10-30T23:30:00Z', // 01:30 CEST
      '2027-10-31T00:00:00Z', // 02:00 CEST, the first of two
      '2027-10-31T00:30:00Z', // 02:30 CEST, the first of two
      '2027-10-31T02:00:00Z', // 03:00 CET
      '2027-10-31T02:30:00Z', // 03:30 CET
    ]);
  });

  it('BR-15 ends a slot in elapsed time, so it reaches over a change', () => {
    const lastBeforeGap: SlotRule = { ...sunday, startMinute: 90, endMinute: 120 };
    const day = date('2027-03-28');
    const [slot] = generateSlots({ ...INPUT, rules: [lastBeforeGap], from: day, to: day });
    expect(slot?.endsAt.toString()).toBe('2027-03-28T01:00:00Z');
  });

  it('BR-15 respects a Friday and Saturday weekend and a closed day in Riyadh', () => {
    const everyDay = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      ...RULE,
      id: String(weekday),
      weekday,
    }));
    const weekdays = generateSlots({
      ...INPUT,
      rules: everyDay,
      timeZone: 'Asia/Riyadh',
      weekendDays: [5, 6],
      closedDays: new Set(['2026-11-19']),
      from: date('2026-11-15'), // Sunday
      to: date('2026-11-21'), // Saturday
    }).map(({ startsAt }) => startsAt.toZonedDateTimeISO('Asia/Riyadh').dayOfWeek);
    // Sunday to Wednesday; the Thursday is closed, Friday and Saturday are the weekend.
    expect(weekdays).toEqual([7, 1, 2, 3]);
  });

  it('BR-06 generates nothing in a provider’s absence, also when it only touches a part', () => {
    const absences = [
      {
        providerId: 'provider',
        startsAt: instant('2027-03-22T07:29:00Z'),
        endsAt: instant('2027-03-22T09:00:00Z'),
      },
    ];
    expect(startsOf({ absences })).toEqual([]);
  });

  it('BR-06 keeps the slots of others and the slots next to an absence', () => {
    const someoneElse = {
      providerId: 'other',
      startsAt: instant('2027-03-22T00:00:00Z'),
      endsAt: instant('2027-03-23T00:00:00Z'),
    };
    const endsAtTheStart = {
      providerId: 'provider',
      startsAt: instant('2027-03-22T06:00:00Z'),
      endsAt: instant('2027-03-22T07:00:00Z'),
    };
    const startsAtTheEnd = {
      providerId: 'provider',
      startsAt: instant('2027-03-22T07:30:00Z'),
      endsAt: instant('2027-03-22T08:00:00Z'),
    };
    expect(startsOf({ absences: [someoneElse, endsAtTheStart, startsAtTheEnd] })).toEqual([
      '2027-03-22T07:00:00Z',
    ]);
  });

  it('BR-06 applies a rule only while it is valid, both ends included', () => {
    const rule: SlotRule = { ...RULE, validFrom: date('2027-03-22'), validTo: date('2027-03-29') };
    expect(startsOf({ rules: [rule], from: date('2027-03-15'), to: date('2027-04-05') })).toEqual([
      '2027-03-22T07:00:00Z',
      '2027-03-29T06:00:00Z',
    ]);
  });

  it('fills a rule with slots that fit whole, and drops a rest', () => {
    const rule: SlotRule = { ...RULE, startMinute: 480, endMinute: 550, slotMinutes: 30 };
    expect(startsOf({ rules: [rule] })).toEqual(['2027-03-22T07:00:00Z', '2027-03-22T07:30:00Z']);
  });

  it('reaches the last minute of a day', () => {
    const rule: SlotRule = { ...RULE, startMinute: 1410, endMinute: 1440, slotMinutes: 30 };
    expect(startsOf({ rules: [rule] })).toEqual(['2027-03-22T22:30:00Z']);
  });
});

describe('dayRange', () => {
  it('BR-15 starts a day at its first existing time: Cairo 2027-04-30 has no midnight', () => {
    const { start, end } = dayRange(date('2027-04-30'), 'Africa/Cairo');
    expect(start.toString()).toBe('2027-04-29T22:00:00Z');
    expect(end.toString()).toBe('2027-04-30T21:00:00Z');
    expect(start.until(end).total('hours')).toBe(23);
  });

  it('BR-15 knows the 25-hour day in Cairo', () => {
    const { start, end } = dayRange(date('2027-10-28'), 'Africa/Cairo');
    expect(start.until(end).total('hours')).toBe(25);
  });
});

describe('bookableWindow (BR-03)', () => {
  it('BR-03 counts the lead time across a clock change in elapsed time', () => {
    const { earliest } = bookableWindow(instant('2027-03-27T23:30:00Z'), {
      minLeadTimeMinutes: 120,
      maxHorizonDays: 90,
    });
    // The 03:00 CEST slot (01:00Z) is not bookable, 03:30 CEST (01:30Z) is.
    expect(Temporal.Instant.compare(instant('2027-03-28T01:00:00Z'), earliest)).toBeLessThan(0);
    expect(Temporal.Instant.compare(instant('2027-03-28T01:30:00Z'), earliest)).toBe(0);
  });

  it('BR-03 ends at the horizon', () => {
    const { latest } = bookableWindow(instant('2026-11-15T07:00:00Z'), {
      minLeadTimeMinutes: 0,
      maxHorizonDays: 90,
    });
    expect(latest.toString()).toBe('2027-02-13T07:00:00Z');
  });
});

describe('daysInRange', () => {
  it('counts both ends, and nothing for a range that runs backwards', () => {
    expect(daysInRange(date('2026-11-15'), date('2026-11-15'))).toBe(1);
    expect(daysInRange(date('2026-11-15'), date('2026-12-26'))).toBe(42);
    expect(daysInRange(date('2026-11-15'), date('2026-11-14'))).toBe(0);
  });
});

describe('daysWithFreeTimes', () => {
  it('answers every day of the range by its local date, with no count', () => {
    const days = daysWithFreeTimes(
      date('2026-11-15'),
      date('2026-11-17'),
      // 00:30 on the 16th in Riyadh, although it is still the 15th in UTC.
      [instant('2026-11-15T21:30:00Z'), instant('2026-11-15T21:45:00Z')],
      'Asia/Riyadh',
    );
    expect(days.map(({ date: day, hasFreeTimes }) => [day.toString(), hasFreeTimes])).toEqual([
      ['2026-11-15', false],
      ['2026-11-16', true],
      ['2026-11-17', false],
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  draftOf,
  durationsWith,
  intervalsOfDraft,
  nextRangeOf,
  problemOf,
  weekdaysFrom,
  weekLinesOf,
} from './setup-view';

const WORKDAY = { opensAt: '08:00', closesAt: '16:00' };

describe('weekLinesOf', () => {
  it('joins days in a row with the same hours, from the practice’s first day', () => {
    // Riyadh: the week starts on Sunday; open Sunday to Thursday, closed Friday and Saturday.
    const intervals = [7, 1, 2, 3, 4].map((weekday) => ({ weekday, ...WORKDAY }));
    expect(weekLinesOf(intervals, 7)).toEqual([
      { first: 7, last: 4, ranges: [WORKDAY] },
      { first: 5, last: 6, ranges: [] },
    ]);
  });

  it('keeps a day with other or more hours on a line of its own', () => {
    const intervals = [
      { weekday: 1, ...WORKDAY },
      { weekday: 2, opensAt: '16:00', closesAt: '24:00' },
      { weekday: 2, opensAt: '08:00', closesAt: '12:00' },
      { weekday: 3, ...WORKDAY },
    ];
    expect(weekLinesOf(intervals, 1).map(({ first, last }) => [first, last])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 7],
    ]);
    expect(weekLinesOf(intervals, 1)[1]?.ranges).toEqual([
      { opensAt: '08:00', closesAt: '12:00' },
      { opensAt: '16:00', closesAt: '24:00' },
    ]);
  });
});

describe('the editor’s week', () => {
  let keys = 0;
  const nextKey = (): string => {
    keys += 1;
    return `k${String(keys)}`;
  };

  it('shows the end of the day as 00:00 and sends it back as 24:00, in the order of the week', () => {
    const draft = draftOf(
      [
        { weekday: 1, opensAt: '16:00', closesAt: '24:00' },
        { weekday: 7, ...WORKDAY },
      ],
      nextKey,
    );
    expect(draft[1]?.[0]).toMatchObject({ opensAt: '16:00', closesAt: '00:00' });
    expect(draft[3]).toEqual([]);
    const { intervals, keys: sent } = intervalsOfDraft(draft, 7);
    expect(intervals).toEqual([
      { weekday: 7, ...WORKDAY },
      { weekday: 1, opensAt: '16:00', closesAt: '24:00' },
    ]);
    expect(sent).toEqual([draft[7]?.[0]?.key, draft[1]?.[0]?.key]);
  });

  it('tells a range that closes before it opens or misses a time, but lets midnight close it', () => {
    expect(problemOf({ opensAt: '12:00', closesAt: '08:00' })).toBe('closesBeforeOpens');
    expect(problemOf({ opensAt: '12:00', closesAt: '12:00' })).toBe('closesBeforeOpens');
    expect(problemOf({ opensAt: '', closesAt: '08:00' })).toBe('missingTime');
    expect(problemOf({ opensAt: '16:00', closesAt: '00:00' })).toBeUndefined();
  });

  it('starts new hours after the last ones of the day', () => {
    expect(nextRangeOf([])).toEqual(WORKDAY);
    expect(nextRangeOf([{ opensAt: '08:00', closesAt: '12:00' }])).toEqual({
      opensAt: '13:00',
      closesAt: '17:00',
    });
    expect(nextRangeOf([{ opensAt: '16:00', closesAt: '00:00' }])).toEqual({
      opensAt: '',
      closesAt: '',
    });
  });

  it('counts the week from its first day', () => {
    expect(weekdaysFrom(7)).toEqual([7, 1, 2, 3, 4, 5, 6]);
    expect(weekdaysFrom(6)).toEqual([6, 7, 1, 2, 3, 4, 5]);
  });
});

describe('durationsWith', () => {
  it('offers a service’s own duration among the usual ones', () => {
    expect(durationsWith(30)).not.toContain(35);
    expect(durationsWith(35)).toContain(35);
    expect(durationsWith(35).indexOf(35)).toBe(durationsWith(35).indexOf(30) + 1);
  });
});

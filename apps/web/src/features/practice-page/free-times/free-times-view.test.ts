import { describe, expect, it } from 'vitest';
import { safeReturnPath } from '@/lib/safe-return-path';
import {
  addDays,
  handOffHref,
  nextRovingIndex,
  partsOfDay,
  practiceAddressOf,
  selectedDay,
  weeksFrom,
} from './free-times-view';

describe('addDays', () => {
  it('crosses a month, a year and a clock change', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-28', 1)).toBe('2027-03-29');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  });
});

describe('weeksFrom', () => {
  it('starts on the practice’s first weekday: Sunday in Riyadh', () => {
    // 2026-11-11 is a Wednesday.
    const weeks = weeksFrom('2026-11-11', 7, '2026-11-20');
    expect(weeks.map((week) => week[0])).toEqual(['2026-11-08', '2026-11-15']);
    expect(weeks[0]).toHaveLength(7);
  });

  it('starts on the practice’s first weekday: Monday in Berlin', () => {
    expect(weeksFrom('2026-11-11', 1, '2026-11-11').map((week) => week[0])).toEqual(['2026-11-09']);
  });

  it('starts on today when today is that weekday', () => {
    expect(weeksFrom('2026-11-08', 7, '2026-11-08')[0]?.[0]).toBe('2026-11-08');
  });
});

describe('selectedDay', () => {
  const days = [
    { date: '2026-11-08', hasFreeTimes: false },
    { date: '2026-11-09', hasFreeTimes: true },
    { date: '2026-11-10', hasFreeTimes: true },
  ];

  it('keeps the chosen day while it has free times', () => {
    expect(selectedDay(days, '2026-11-10')).toBe('2026-11-10');
  });

  it('falls back to the first free day when the chosen one filled up', () => {
    expect(selectedDay(days, '2026-11-08')).toBe('2026-11-09');
    expect(selectedDay(days, undefined)).toBe('2026-11-09');
  });

  it('has nothing to select without a free day', () => {
    expect(selectedDay([{ date: '2026-11-08', hasFreeTimes: false }], undefined)).toBeUndefined();
  });
});

describe('partsOfDay', () => {
  it('divides at noon on the practice’s clock', () => {
    const hour = (time: number): number => time;
    expect(partsOfDay([9, 11, 12, 16], hour)).toEqual({ morning: [9, 11], afternoon: [12, 16] });
  });
});

describe('nextRovingIndex', () => {
  it.each([
    ['ltr', 'ArrowRight', 1, 2],
    ['ltr', 'ArrowLeft', 1, 0],
    ['rtl', 'ArrowLeft', 1, 2],
    ['rtl', 'ArrowRight', 1, 0],
    ['ltr', 'ArrowDown', 1, 2],
    ['rtl', 'ArrowDown', 1, 2],
    ['ltr', 'ArrowUp', 1, 0],
    ['rtl', 'ArrowUp', 1, 0],
    ['ltr', 'Home', 2, 0],
    ['rtl', 'End', 0, 3],
  ] as const)('%s: %s from %i leads to %i', (direction, key, current, expected) => {
    expect(nextRovingIndex(current, key, 4, direction)).toBe(expected);
  });

  it('stops at both ends', () => {
    expect(nextRovingIndex(3, 'ArrowRight', 4, 'ltr')).toBe(3);
    expect(nextRovingIndex(0, 'ArrowLeft', 4, 'ltr')).toBe(0);
  });

  it('ignores every other key', () => {
    expect(nextRovingIndex(1, 'Enter', 4, 'ltr')).toBeUndefined();
  });
});

describe('the hand-off to sign-in', () => {
  it('names the practice in the fragment, and survives safeReturnPath', () => {
    const url = new URL(handOffHref('ar', 'al-noor'), 'https://site.example');
    expect(url.pathname).toBe('/ar/sign-in');
    expect(url.search).toBe('');
    const next = new URLSearchParams(url.hash.slice(1)).get('next');
    expect(next).toBe('/ar/al-noor');
    expect(safeReturnPath(next)).toBe(next);
  });

  it('leads back to the free times of the practice', () => {
    expect(practiceAddressOf('/ar/al-noor')).toBe('/ar/al-noor#free-times');
  });
});

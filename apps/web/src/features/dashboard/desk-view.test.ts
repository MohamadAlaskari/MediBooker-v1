import type { DeskDayDto } from '@medibooker/api-client';
import { describe, expect, it } from 'vitest';
import {
  dayPartOf,
  figuresOf,
  initialsOf,
  mainActionOf,
  nextDay,
  statusVariantOf,
} from './desk-view';

describe('dayPartOf', () => {
  it('greets by the hour of the practice', () => {
    expect(dayPartOf(0)).toBe('morning');
    expect(dayPartOf(11)).toBe('morning');
    expect(dayPartOf(12)).toBe('afternoon');
    expect(dayPartOf(17)).toBe('afternoon');
    expect(dayPartOf(18)).toBe('evening');
  });
});

describe('initialsOf', () => {
  it('takes the first letter of each name, in capitals', () => {
    expect(initialsOf('sara', 'ahmed', 'en')).toBe('S‌A');
  });

  it('keeps two Arabic letters from joining, and leaves out an empty name', () => {
    expect(initialsOf('سارة', 'أحمد', 'ar')).toBe('س‌أ');
    expect(initialsOf('سارة', ' ', 'ar')).toBe('س');
  });
});

describe('statusVariantOf', () => {
  it('gives every status its colour of Figma', () => {
    expect(statusVariantOf('BOOKED')).toBe('brandSubtle');
    expect(statusVariantOf('CHECKED_IN')).toBe('info');
    expect(statusVariantOf('COMPLETED')).toBe('success');
    expect(statusVariantOf('NO_SHOW')).toBe('warning');
    expect(statusVariantOf('CANCELLED')).toBe('danger');
  });
});

describe('figuresOf', () => {
  it('counts the visits of the whole day, who came and who waits', () => {
    const day = {
      counts: { booked: 4, checkedIn: 2, completed: 3, noShow: 1, cancelled: 5 },
      openTimes: 6,
      nextOpenAt: '2026-11-15T07:30:00Z',
    } as DeskDayDto;
    expect(figuresOf(day)).toEqual({
      appointments: 10,
      completed: 3,
      arrived: 5,
      waiting: 2,
      openTimes: 6,
      nextOpenAt: '2026-11-15T07:30:00Z',
      cancelled: 5,
      noShow: 1,
    });
  });
});

describe('mainActionOf', () => {
  it('offers a check-in first, then a completion, else nothing', () => {
    expect(mainActionOf({ actions: ['CHECK_IN', 'NO_SHOW', 'CANCEL'] })).toBe('CHECK_IN');
    expect(mainActionOf({ actions: ['COMPLETE'] })).toBe('COMPLETE');
    expect(mainActionOf({ actions: ['CANCEL'] })).toBeUndefined();
  });
});

describe('nextDay', () => {
  it('moves a date across the ends of months and years', () => {
    expect(nextDay('2026-11-15', 1)).toBe('2026-11-16');
    expect(nextDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(nextDay('2026-03-01', -1)).toBe('2026-02-28');
  });
});

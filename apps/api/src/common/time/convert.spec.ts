import { describe, expect, it } from 'vitest';
import { dbDateOf, plainDateOf } from './convert.js';

describe('date column conversions', () => {
  it('read a date column as the same calendar date, in any host time zone', () => {
    expect(plainDateOf(new Date('2026-11-19T00:00:00.000Z')).toString()).toBe('2026-11-19');
  });

  it('write a calendar date as midnight UTC', () => {
    expect(dbDateOf(Temporal.PlainDate.from('2026-11-19')).toISOString()).toBe(
      '2026-11-19T00:00:00.000Z',
    );
  });

  it('round-trip across a DST change', () => {
    const date = Temporal.PlainDate.from('2027-03-28');
    expect(plainDateOf(dbDateOf(date)).equals(date)).toBe(true);
  });
});

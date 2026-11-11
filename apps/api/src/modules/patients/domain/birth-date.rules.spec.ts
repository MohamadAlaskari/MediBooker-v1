import { describe, expect, it } from 'vitest';
import { birthDateOf } from './birth-date.rules.js';

const TODAY = Temporal.PlainDate.from('2026-11-15');

describe('birthDateOf', () => {
  it('takes a real date before today', () => {
    expect(birthDateOf('1987-06-21', TODAY)).toEqual({
      value: Temporal.PlainDate.from('1987-06-21'),
      problems: [],
    });
  });

  it('asks for a date that is missing', () => {
    expect(birthDateOf(undefined, TODAY)).toEqual({
      value: undefined,
      problems: [{ field: 'dateOfBirth', code: 'REQUIRED' }],
    });
  });

  it('refuses a date that does not exist, today, and the future', () => {
    for (const value of ['2026-02-31', '2026-11-15', '2027-01-01']) {
      expect(birthDateOf(value, TODAY)).toEqual({
        value: undefined,
        problems: [{ field: 'dateOfBirth', code: 'INVALID_VALUE' }],
      });
    }
  });
});

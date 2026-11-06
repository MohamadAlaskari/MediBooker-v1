import { describe, expect, it } from 'vitest';
import {
  insuranceNumberEnd,
  isPlausibleBirthDate,
  needsInsuranceDetails,
} from './profile.rules.js';

describe('needsInsuranceDetails', () => {
  it('asks self-payers for nothing, and everyone else for their insurance', () => {
    expect(needsInsuranceDetails('SELF_PAY')).toBe(false);
    expect(needsInsuranceDetails('PUBLIC')).toBe(true);
    expect(needsInsuranceDetails('PRIVATE')).toBe(true);
  });
});

describe('insuranceNumberEnd', () => {
  it('shows the last four characters, without separators', () => {
    expect(insuranceNumberEnd('AN-4821-77')).toBe('2177');
    expect(insuranceNumberEnd('A123 456 789')).toBe('6789');
  });

  it('never shows more than half of a short number', () => {
    expect(insuranceNumberEnd('123456')).toBe('456');
    expect(insuranceNumberEnd('1234567')).toBe('567');
    expect(insuranceNumberEnd('12')).toBe('2');
    expect(insuranceNumberEnd('1')).toBe('');
  });
});

describe('isPlausibleBirthDate', () => {
  const today = Temporal.PlainDate.from('2026-11-15');
  const of = (date: string): Temporal.PlainDate => Temporal.PlainDate.from(date);

  it('takes a day in the past', () => {
    expect(isPlausibleBirthDate(of('1990-05-14'), today)).toBe(true);
    expect(isPlausibleBirthDate(of('2026-11-14'), today)).toBe(true);
    expect(isPlausibleBirthDate(of('1900-01-01'), today)).toBe(true);
  });

  it('refuses today, the future and a date no one alive can have', () => {
    expect(isPlausibleBirthDate(today, today)).toBe(false);
    expect(isPlausibleBirthDate(of('2030-01-01'), today)).toBe(false);
    expect(isPlausibleBirthDate(of('1899-12-31'), today)).toBe(false);
  });
});

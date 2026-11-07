import { describe, expect, it } from 'vitest';
import {
  checkedInsurance,
  type InsuranceRules,
  isValidInsuranceNumber,
  normalizedInsuranceNumber,
} from './insurance.rules.js';

const RULES: InsuranceRules = {
  insuranceTypes: ['PUBLIC', 'PRIVATE', 'SELF_PAY'],
  insuranceProviderTypes: ['PUBLIC', 'PRIVATE'],
  insuranceNumberTypes: ['PUBLIC', 'PRIVATE'],
};
const ARABIC_NUMBER = `A${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => String.fromCodePoint(0x0660 + digit)).join('')}`;
const PERSIAN_NUMBER = `A${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => String.fromCodePoint(0x06f0 + digit)).join('')}`;
const CYRILLIC_A = String.fromCodePoint(0x0410);
const DEVANAGARI_ONE = String.fromCodePoint(0x0967);

describe('normalizedInsuranceNumber', () => {
  it.each([
    ['A123456789', 'A123456789'],
    ['a123456789', 'A123456789'],
    ['A 123 456 789', 'A123456789'],
    ['A-123.456/789', 'A123456789'],
    [ARABIC_NUMBER, 'A123456789'],
    [PERSIAN_NUMBER, 'A123456789'],
  ])('gives %j one spelling', (raw, expected) => {
    expect(normalizedInsuranceNumber(raw)).toBe(expected);
  });

  it('gives the same number in two scripts the same spelling', () => {
    expect(normalizedInsuranceNumber(ARABIC_NUMBER)).toBe(normalizedInsuranceNumber('A123456789'));
  });

  it.each([
    [`${CYRILLIC_A}123456789`, 'a letter that only looks Latin'],
    [`A12345678${DEVANAGARI_ONE}`, 'a digit of another script'],
    ['A12345_789', 'another sign'],
    ['', 'nothing'],
    ['   ', 'only spaces'],
    ['straße', 'a letter that changes when upper-cased'],
  ])('refuses %j: %s', (raw) => {
    expect(normalizedInsuranceNumber(raw)).toBeUndefined();
  });
});

describe('isValidInsuranceNumber', () => {
  it('takes a letter and nine digits for the public insurance in Germany', () => {
    expect(isValidInsuranceNumber('DE', 'PUBLIC', 'A123456789')).toBe(true);
    expect(isValidInsuranceNumber('DE', 'PUBLIC', 'A12345678')).toBe(false);
    expect(isValidInsuranceNumber('DE', 'PUBLIC', 'A1234567890')).toBe(false);
    expect(isValidInsuranceNumber('DE', 'PUBLIC', '1123456789')).toBe(false);
  });

  it('is less strict for a private insurance in Germany and in a market without a format', () => {
    expect(isValidInsuranceNumber('DE', 'PRIVATE', 'ABC123')).toBe(true);
    expect(isValidInsuranceNumber('SA', 'PUBLIC', '12345678')).toBe(true);
    expect(isValidInsuranceNumber('SA', 'PUBLIC', '12345')).toBe(false);
  });
});

describe('checkedInsurance', () => {
  const details = { type: 'PUBLIC', provider: 'AOK', number: 'A123456789', numberKnown: false };

  it('takes what fits, with the number in its one spelling', () => {
    expect(
      checkedInsurance(RULES, 'DE', { ...details, type: 'PUBLIC', number: ARABIC_NUMBER }),
    ).toEqual({ problems: [], provider: 'AOK', number: 'A123456789' });
  });

  it('asks for a type, and only for a type, when there is none', () => {
    expect(checkedInsurance(RULES, 'DE', { ...details, type: undefined }).problems).toEqual([
      { field: 'insuranceType', code: 'REQUIRED' },
    ]);
  });

  it('refuses a type the practice does not take', () => {
    const rules = { ...RULES, insuranceTypes: ['SELF_PAY'] };
    expect(checkedInsurance(rules, 'DE', { ...details, type: 'PUBLIC' }).problems).toEqual([
      { field: 'insuranceType', code: 'INVALID_VALUE' },
    ]);
  });

  it('asks a self-payer for nothing, and keeps nothing they send', () => {
    expect(
      checkedInsurance(RULES, 'DE', {
        type: 'SELF_PAY',
        provider: 'AOK',
        number: 'A123456789',
        numberKnown: false,
      }),
    ).toEqual({ problems: [], provider: null, number: undefined });
  });

  it('asks for all that is missing in one answer', () => {
    expect(
      checkedInsurance(RULES, 'DE', {
        type: 'PUBLIC',
        provider: null,
        number: undefined,
        numberKnown: false,
      }).problems,
    ).toEqual([
      { field: 'insuranceProvider', code: 'REQUIRED' },
      { field: 'insuranceNumber', code: 'REQUIRED' },
    ]);
  });

  it('takes an empty provider for none', () => {
    expect(
      checkedInsurance(RULES, 'DE', { ...details, type: 'PUBLIC', provider: '' }).problems,
    ).toEqual([{ field: 'insuranceProvider', code: 'REQUIRED' }]);
  });

  it('does not ask again for a number the row already has', () => {
    expect(
      checkedInsurance(RULES, 'DE', {
        ...details,
        type: 'PUBLIC',
        number: undefined,
        numberKnown: true,
      }).problems,
    ).toEqual([]);
  });

  it('asks only for what the practice wants', () => {
    const rules = { ...RULES, insuranceProviderTypes: [], insuranceNumberTypes: [] };
    expect(
      checkedInsurance(rules, 'DE', {
        type: 'PRIVATE',
        provider: undefined,
        number: undefined,
        numberKnown: false,
      }).problems,
    ).toEqual([]);
  });

  it('refuses a number of the wrong format, and one in another script', () => {
    expect(
      checkedInsurance(RULES, 'DE', { ...details, type: 'PUBLIC', number: 'A12' }).problems,
    ).toEqual([{ field: 'insuranceNumber', code: 'INVALID_VALUE' }]);
    expect(
      checkedInsurance(RULES, 'DE', {
        ...details,
        type: 'PUBLIC',
        number: `${CYRILLIC_A}123456789`,
      }).problems,
    ).toEqual([{ field: 'insuranceNumber', code: 'INVALID_VALUE' }]);
  });
});

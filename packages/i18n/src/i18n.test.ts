import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, getDirection, isLocale, LOCALES, negotiateLocale } from './index.js';

describe('LOCALES', () => {
  it('equals locales.json, which config files read without a build', () => {
    const file = readFileSync(new URL('../locales.json', import.meta.url), 'utf8');
    expect(JSON.parse(file)).toEqual(LOCALES);
  });

  it('has Arabic as the default', () => {
    expect(DEFAULT_LOCALE).toBe('ar');
  });

  it.each([
    ['ar', true],
    ['en', true],
    ['de', false],
    ['', false],
    [undefined, false],
  ])('isLocale(%s) is %s', (value, expected) => {
    expect(isLocale(value)).toBe(expected);
  });
});

describe('getDirection', () => {
  it.each([
    ['ar', 'rtl'],
    ['fa', 'rtl'],
    ['he', 'rtl'],
    ['ur', 'rtl'],
    ['en', 'ltr'],
    ['de', 'ltr'],
  ])('%s is %s', (locale, direction) => {
    expect(getDirection(locale)).toBe(direction);
  });
});

describe('negotiateLocale', () => {
  it.each([
    [undefined, 'ar'],
    [null, 'ar'],
    ['', 'ar'],
    ['en', 'en'],
    ['en-US,en;q=0.9,ar;q=0.8', 'en'],
    ['ar;q=0.5,en;q=0.9', 'en'],
    ['de,fr;q=0.9', 'ar'],
    ['de,en;q=0.1', 'en'],
    ['*', 'ar'],
    ['en;q=0', 'ar'],
    ['en;q=nonsense', 'ar'],
    ['EN-gb', 'en'],
  ])('reads %s as %s', (header, locale) => {
    expect(negotiateLocale(header)).toBe(locale);
  });

  it('reads only the first 20 language ranges of a long header', () => {
    expect(negotiateLocale(`${Array.from({ length: 20 }, () => 'de').join(',')},en`)).toBe('ar');
  });
});

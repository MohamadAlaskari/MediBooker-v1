import { describe, expect, it } from 'vitest';
import { negotiateLocale, textFor } from './locale.js';

const SUPPORTED = ['ar', 'en'];

describe('negotiateLocale', () => {
  it.each([
    [undefined, 'ar'],
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
    expect(negotiateLocale(header, SUPPORTED, 'ar')).toBe(locale);
  });

  it('falls back to the given default locale', () => {
    expect(negotiateLocale('de', SUPPORTED, 'en')).toBe('en');
  });

  it('reads only the first 20 language ranges of a long header', () => {
    const header = `${Array.from({ length: 20 }, () => 'de').join(',')},en`;
    expect(negotiateLocale(header, SUPPORTED, 'ar')).toBe('ar');
  });
});

describe('textFor', () => {
  it('takes the locale, then the fallback, then nothing', () => {
    const value = { ar: 'نص', en: 'text' };
    expect(textFor(value, 'en', 'ar')).toBe('text');
    expect(textFor({ ar: 'نص' }, 'en', 'ar')).toBe('نص');
    expect(textFor({}, 'en', 'ar')).toBeNull();
  });

  it('counts an empty text and anything but an object as missing', () => {
    expect(textFor({ en: '', ar: 'نص' }, 'en', 'ar')).toBe('نص');
    expect(textFor('text', 'en', 'ar')).toBeNull();
    expect(textFor(null, 'en', 'ar')).toBeNull();
    expect(textFor({ en: 1 }, 'en', 'ar')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { ownLanguageName, practiceFormat } from './format';

const riyadh = { numberingSystem: 'latn', hourCycle: 'h23', timeZone: 'Asia/Riyadh' };
const berlin = { numberingSystem: 'latn', hourCycle: 'h23', timeZone: 'Europe/Berlin' };

describe('practiceFormat', () => {
  it('reads a wall-clock time as it stands, whatever the zone of the server', () => {
    expect(practiceFormat('en', riyadh).clock('08:30')).toBe('08:30');
    expect(practiceFormat('en', { ...riyadh, hourCycle: 'h12' }).clock('16:00')).toMatch(
      /^4:00\sPM$/,
    );
  });

  it('writes the digits of the practice', () => {
    const arabicDigits = practiceFormat('ar', { ...riyadh, numberingSystem: 'arab' });
    expect(arabicDigits.clock('08:30')).toBe('٠٨:٣٠');
    expect(arabicDigits.number(30)).toBe('٣٠');
    expect(practiceFormat('ar', riyadh).clock('08:30')).toBe('08:30');
    expect(practiceFormat('ar', riyadh).number(30)).toBe('30');
  });

  it('reads the end of the day as midnight', () => {
    expect(practiceFormat('en', riyadh).clock('24:00')).toBe('00:00');
  });

  it('names ISO weekdays in the language', () => {
    const english = practiceFormat('en', riyadh);
    expect(english.weekday(1)).toBe('Monday');
    expect(english.weekday(7)).toBe('Sunday');
    expect(practiceFormat('ar', riyadh).weekday(5)).toBe('الجمعة');
  });

  it('writes a date of the practice without moving it to another day', () => {
    expect(practiceFormat('en', riyadh).day('2026-11-19')).toBe('Thu, Nov 19');
    expect(practiceFormat('en', berlin).year('2026-01-01')).toBe('2026');
  });

  it('writes a day of the practice in the forms of the picker, with its digits', () => {
    const english = practiceFormat('en', riyadh);
    expect(english.dayLong('2026-11-04')).toBe('Wednesday, November 4');
    expect(english.monthYear('2026-11-04')).toBe('November 2026');
    expect(english.weekdayShort('2026-11-04')).toBe('Wed');
    expect(english.dayOfMonth('2026-11-04')).toBe('4');
    expect(
      practiceFormat('ar', { ...riyadh, numberingSystem: 'arab' }).dayOfMonth('2026-11-04'),
    ).toBe('٤');
  });

  it('gives the hour of an instant on the clock of the practice, for calculating', () => {
    expect(practiceFormat('ar', riyadh).instantHour('2026-11-08T09:00:00Z')).toBe(12);
    expect(practiceFormat('en', berlin).instantHour('2026-11-08T22:30:00Z')).toBe(23);
    expect(practiceFormat('en', berlin).instantHour('2026-11-08T23:30:00Z')).toBe(0);
  });

  it('reads an instant in the zone of the practice, also across a clock change', () => {
    const before = practiceFormat('en', berlin);
    expect(before.instantTime('2027-03-28T00:30:00Z')).toBe('01:30');
    expect(before.instantTime('2027-03-28T01:30:00Z')).toBe('03:30');
    const instant = '2026-11-08T22:00:00Z';
    expect(practiceFormat('en', riyadh).instantDate(instant)).toBe('2026-11-09');
    expect(practiceFormat('en', riyadh).instantWeekday(instant)).toBe('Monday');
    expect(practiceFormat('en', berlin).instantDate(instant)).toBe('2026-11-08');
  });

  it('writes languages as a sentence part', () => {
    expect(practiceFormat('en', riyadh).languages(['ar', 'en'])).toBe('Arabic and English');
    expect(practiceFormat('ar', riyadh).languages(['ar', 'en'])).toBe('العربية والإنجليزية');
  });

  it('writes a code that is no language as it stands, and keeps the page', () => {
    expect(practiceFormat('en', riyadh).languages(['en', 'not a code'])).toBe(
      'English and not a code',
    );
  });
});

describe('ownLanguageName', () => {
  it('names a language in itself', () => {
    expect(ownLanguageName('ar')).toBe('العربية');
    expect(ownLanguageName('en')).toBe('English');
  });
});

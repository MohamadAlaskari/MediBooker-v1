import { describe, expect, it } from 'vitest';
import {
  intervalsOf,
  LINE_TEXT,
  LINES_TEXT,
  minutesOf,
  specialDayOf,
  textsOf,
} from './practice-setup.rules.js';

const LOCALES = ['ar', 'en'];
const TODAY = Temporal.PlainDate.from('2026-11-15');

describe('textsOf', () => {
  const required = { required: true, max: 10, pattern: LINE_TEXT };

  it('keeps the trimmed text of every locale', () => {
    expect(textsOf('name', { ar: ' فحص ', en: 'Check-up' }, LOCALES, required)).toEqual({
      problems: [],
      value: { ar: 'فحص', en: 'Check-up' },
    });
  });

  it('asks a required text in every locale of the practice, and only those', () => {
    expect(textsOf('name', { en: '  ', de: 'Kontrolle' }, LOCALES, required).problems).toEqual([
      { field: 'name.de', code: 'UNKNOWN_FIELD' },
      { field: 'name.ar', code: 'REQUIRED' },
      { field: 'name.en', code: 'REQUIRED' },
    ]);
  });

  it('refuses a text too long or not a text, without asking it again', () => {
    expect(textsOf('name', { ar: 'x'.repeat(11), en: 7 }, LOCALES, required).problems).toEqual([
      { field: 'name.ar', code: 'TOO_LONG' },
      { field: 'name.en', code: 'INVALID_TYPE' },
    ]);
  });

  it('leaves out the empty texts of an optional field', () => {
    expect(
      textsOf('description', { ar: '', en: 'Fasting' }, LOCALES, {
        required: false,
        max: 10,
        pattern: LINES_TEXT,
      }),
    ).toEqual({ problems: [], value: { en: 'Fasting' } });
  });

  it('refuses letters that show nothing, and repeats no key that cannot be a language', () => {
    expect(textsOf('name', { ar: 'ㅤㅤ', en: '⠀ ﾠ' }, LOCALES, required).problems).toEqual([
      { field: 'name.ar', code: 'INVALID_FORMAT' },
      { field: 'name.en', code: 'INVALID_FORMAT' },
    ]);
    const odd = { ['x'.repeat(36)]: 'a', 'a b': 'c', ar: 'فحص', en: 'Check-up' };
    expect(textsOf('name', odd, LOCALES, required).problems).toEqual([
      { field: 'name', code: 'UNKNOWN_FIELD' },
    ]);
  });

  it('refuses what a screen would not show, and a second line in a name', () => {
    expect(textsOf('name', { ar: 'a‮b', en: 'a\nb' }, LOCALES, required).problems).toEqual([
      { field: 'name.ar', code: 'INVALID_FORMAT' },
      { field: 'name.en', code: 'INVALID_FORMAT' },
    ]);
    expect(LINES_TEXT.test('Fasting:\nno food')).toBe(true);
  });
});

describe('intervalsOf', () => {
  it('turns the times into minutes after midnight, 24:00 being the end of the day', () => {
    expect(minutesOf('08:30')).toBe(510);
    expect(intervalsOf([{ weekday: 7, opensAt: '16:00', closesAt: '24:00' }])).toEqual({
      problems: [],
      value: [{ weekday: 7, opensAt: 960, closesAt: 1440 }],
    });
  });

  it('names an interval that closes before it opens, or opens at the end of the day', () => {
    const { problems } = intervalsOf([
      { weekday: 1, opensAt: '08:00', closesAt: '12:00' },
      { weekday: 1, opensAt: '14:00', closesAt: '14:00' },
      { weekday: 2, opensAt: '24:00', closesAt: '24:00' },
    ]);
    expect(problems).toEqual([
      { field: 'intervals[1].closesAt', code: 'TOO_SMALL' },
      { field: 'intervals[2].opensAt', code: 'INVALID_VALUE' },
    ]);
  });
});

describe('specialDayOf', () => {
  const day = Temporal.PlainDate.from('2026-11-19');

  it('takes a closed day without hours, from today to two years ahead', () => {
    expect(specialDayOf({ date: TODAY, closed: true }, TODAY)).toEqual({
      problems: [],
      value: { opensAt: null, closesAt: null },
    });
    expect(specialDayOf({ date: TODAY.add({ days: 730 }), closed: true }, TODAY).problems).toEqual(
      [],
    );
    expect(specialDayOf({ date: TODAY.add({ days: 731 }), closed: true }, TODAY).problems).toEqual([
      { field: 'date', code: 'TOO_LARGE' },
    ]);
    expect(
      specialDayOf({ date: TODAY.subtract({ days: 1 }), closed: true }, TODAY).problems,
    ).toEqual([{ field: 'date', code: 'TOO_SMALL' }]);
  });

  it('takes other hours that open before they close, and refuses hours on a closed day', () => {
    expect(
      specialDayOf({ date: day, closed: false, opensAt: '09:00', closesAt: '13:00' }, TODAY),
    ).toEqual({ problems: [], value: { opensAt: 540, closesAt: 780 } });
    expect(
      specialDayOf({ date: day, closed: false, opensAt: '13:00', closesAt: '09:00' }, TODAY)
        .problems,
    ).toEqual([{ field: 'closesAt', code: 'TOO_SMALL' }]);
    expect(specialDayOf({ date: day, closed: false, opensAt: '09:00' }, TODAY).problems).toEqual([
      { field: 'closesAt', code: 'REQUIRED' },
    ]);
    expect(specialDayOf({ date: day, closed: false, closesAt: '13:00' }, TODAY).problems).toEqual([
      { field: 'opensAt', code: 'REQUIRED' },
    ]);
    expect(
      specialDayOf({ date: day, closed: false, opensAt: '24:00', closesAt: '24:00' }, TODAY)
        .problems,
    ).toEqual([{ field: 'opensAt', code: 'INVALID_VALUE' }]);
    expect(
      specialDayOf({ date: day, closed: true, opensAt: '09:00', closesAt: '13:00' }, TODAY)
        .problems,
    ).toEqual([
      { field: 'opensAt', code: 'INVALID_VALUE' },
      { field: 'closesAt', code: 'INVALID_VALUE' },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  ARABIC_DIGITS,
  ASCII_DIGITS,
  asciiDigitsOf,
  dateOfSearch,
  patientSearchOf,
  searchTextOf,
} from './patient-search.rules.js';

describe('searchTextOf', () => {
  it('finds "سارة" with and without tashkeel, and written with ه (M05 acceptance)', () => {
    const plain = searchTextOf('سارة');
    expect(searchTextOf('سَارَة')).toBe(plain);
    expect(searchTextOf('ساره')).toBe(plain);
    expect(searchTextOf('سـارة')).toBe(plain);
  });

  it('takes every alef as ا, ى as ي, and drops the hamza of و and ي', () => {
    expect(searchTextOf('أحمد')).toBe(searchTextOf('احمد'));
    expect(searchTextOf('إيمان')).toBe(searchTextOf('ايمان'));
    expect(searchTextOf('آمنة')).toBe(searchTextOf('امنه'));
    expect(searchTextOf('ٱلحسن')).toBe(searchTextOf('الحسن'));
    expect(searchTextOf('مصطفى')).toBe(searchTextOf('مصطفي'));
    expect(searchTextOf('مؤمن')).toBe(searchTextOf('مومن'));
    expect(searchTextOf('هانئ')).toBe(searchTextOf('هاني'));
  });

  it('folds Latin case and accents, and joins spaces', () => {
    expect(searchTextOf('  Müller   Zoë ')).toBe('muller zoe');
    expect(searchTextOf('BEISPIEL')).toBe('beispiel');
  });
});

describe('the digits for the database', () => {
  it('pairs every Arabic digit with its ASCII digit', () => {
    expect(ARABIC_DIGITS).toHaveLength(ASCII_DIGITS.length);
    expect(asciiDigitsOf(ARABIC_DIGITS)).toBe(ASCII_DIGITS);
  });
});

describe('asciiDigitsOf', () => {
  it('reads both Arabic digit sets and leaves the rest', () => {
    expect(asciiDigitsOf('٠٥٠١٢')).toBe('05012');
    expect(asciiDigitsOf('۰۹')).toBe('09');
    expect(asciiDigitsOf('05-12 ab')).toBe('05-12 ab');
    // A digit of another script stays as it is: nobody types it here.
    expect(asciiDigitsOf('৫')).toBe('৫');
  });
});

describe('dateOfSearch', () => {
  it('reads a date of birth in the usual forms, also in Arabic digits', () => {
    expect(dateOfSearch('1990-04-12')).toBe('1990-04-12');
    expect(dateOfSearch('12.04.1990')).toBe('1990-04-12');
    expect(dateOfSearch('12/4/1990')).toBe('1990-04-12');
    expect(dateOfSearch('١٢/٠٤/١٩٩٠')).toBe('1990-04-12');
  });

  it('refuses what is no date', () => {
    expect(dateOfSearch('1990-02-30')).toBeUndefined();
    // The year 0 is a date for Temporal (1 BC), but for no database and no patient.
    expect(dateOfSearch('0000-01-01')).toBeUndefined();
    expect(dateOfSearch('01.01.0000')).toBeUndefined();
    expect(dateOfSearch('Sara')).toBeUndefined();
    expect(dateOfSearch('12.04.90')).toBeUndefined();
  });
});

describe('patientSearchOf', () => {
  it('searches by the words of a name in any order', () => {
    expect(patientSearchOf('Ahmed  Sara')).toEqual({
      words: ['ahmed', 'sara'],
      phoneDigits: undefined,
      dateOfBirth: undefined,
      insuranceNumber: undefined,
    });
  });

  it('compares a word once, and at most six words', () => {
    // Every word is a condition on every patient: a repeated one must not make a search cost more.
    expect(patientSearchOf(Array.from({ length: 33 }, () => 'ال').join(' '))?.words).toEqual([
      'ال',
    ]);
    expect(patientSearchOf('سارة سارة Sara SARA')?.words).toEqual(['ساره', 'sara']);
    expect(patientSearchOf('aa bb cc dd ee ff gg hh')?.words).toEqual([
      'aa',
      'bb',
      'cc',
      'dd',
      'ee',
      'ff',
    ]);
  });

  it('searches by the digits of a phone number, typed in any form', () => {
    expect(patientSearchOf('٠٥٠ ١٢٣٤')).toMatchObject({ words: [], phoneDigits: '501234' });
    expect(patientSearchOf('+966 50')).toMatchObject({ phoneDigits: '96650' });
  });

  it('leaves out the zeros in front, so a local number finds one stored with its country code', () => {
    // 050… typed at the desk is +966 50… on the record, and 00966 is +966.
    expect(patientSearchOf('050 123 4567')).toMatchObject({ phoneDigits: '501234567' });
    expect(patientSearchOf('00966 50 123')).toMatchObject({ phoneDigits: '96650123' });
    // Four digits of the number itself: zeros in front do not count.
    expect(patientSearchOf('0 123')).toBeUndefined();
  });

  it('takes a date for a date of birth, not for a phone number', () => {
    expect(patientSearchOf('12.04.1990')).toMatchObject({
      words: [],
      dateOfBirth: '1990-04-12',
      phoneDigits: undefined,
    });
  });

  it('also tries a whole search as an insurance number', () => {
    expect(patientSearchOf('a123 456 789')).toMatchObject({
      words: [],
      insuranceNumber: 'A123456789',
    });
    expect(patientSearchOf('Sara')).toMatchObject({ insuranceNumber: undefined });
  });

  it('finds nothing to look for in a letter or three digits', () => {
    expect(patientSearchOf('s')).toBeUndefined();
    expect(patientSearchOf('123')).toBeUndefined();
    expect(patientSearchOf('   ')).toBeUndefined();
  });
});

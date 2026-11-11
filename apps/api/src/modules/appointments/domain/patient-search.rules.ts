/**
 * How the team finds a patient (M05, W5 and W8): by name in Arabic and Latin letters, however the
 * name was written, by digits of the phone number, by the date of birth, or by the insurance number.
 * Pure. The database folds every stored name the same way into `patients.search_name`, with its
 * function `patient_search_name` (migration 20261111150000_patient_search_name, which repeats the
 * marks and letters below), so both sides compare like with like.
 */

import { normalizedInsuranceNumber } from '../../patients/domain/insurance.rules.js';

/**
 * What a search ignores after NFD: Latin accents, the Arabic tashkeel, the superscript alef, madda
 * and hamza above and below (so أ إ آ become ا, ؤ و, ئ ي), and the tatweel that only stretches a word.
 */
const IGNORED = /[\u{0300}-\u{036F}\u{064B}-\u{0655}\u{0670}\u{0640}]/gu;

/** A search needs this many letters, or this many digits of a phone number after its zeros in front. */
export const MIN_NAME_LETTERS = 2;
export const MIN_PHONE_DIGITS = 4;

/**
 * The words of a name a search compares at most, each once: every word is one more condition on
 * every patient, and a name rarely has more (security review of M05).
 */
export const MAX_SEARCH_WORDS = 6;

const SPACES = /\s+/gu;

/** A name or a search as both sides compare it. */
export function searchTextOf(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFD')
      .replaceAll(IGNORED, '')
      // Letters written either way: the wasla alef, alef maqsura and ta marbuta, as ا ي ه.
      .replaceAll('\u{0671}', '\u{0627}')
      .replaceAll('\u{0649}', '\u{064A}')
      .replaceAll('\u{0629}', '\u{0647}')
      .replaceAll(SPACES, ' ')
      .trim()
  );
}

/** The zeros of the digits an Arabic keyboard types (٠ and ۰), as `insurance.rules.ts` reads them. */
const ARABIC_ZEROS: readonly number[] = [0x06_60, 0x06_f0];
const DIGITS_IN_A_RUN = 10;

/**
 * Both Arabic digit sets and their ASCII digits, for the database's `translate`: a stored phone
 * number keeps the digits it was typed with.
 */
export const ARABIC_DIGITS = ARABIC_ZEROS.flatMap((zero) =>
  Array.from({ length: DIGITS_IN_A_RUN }, (_, digit) => String.fromCodePoint(zero + digit)),
).join('');
export const ASCII_DIGITS = '0123456789'.repeat(ARABIC_ZEROS.length);

/** Arabic digits as ASCII; anything else stays as it is. */
export function asciiDigitsOf(input: string): string {
  return input.replaceAll(/\p{Nd}/gu, (digit) => {
    const code = digit.charCodeAt(0);
    const zero = ARABIC_ZEROS.find((start) => code >= start && code < start + DIGITS_IN_A_RUN);
    return zero === undefined ? digit : String(code - zero);
  });
}

/** A date of birth typed as 2026-11-04, 04.11.2026 or 04/11/2026; undefined for anything else. */
export function dateOfSearch(input: string): string | undefined {
  const text = asciiDigitsOf(input.trim());
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(text);
  const dotted = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/u.exec(text);
  const match = iso ?? dotted;
  if (match === null) return undefined;
  // A day first in the dotted form; an impossible part makes Temporal refuse the whole date.
  const [year, month, day] =
    iso === null ? [match[3], match[2], match[1]] : [match[1], match[2], match[3]];
  // Temporal reads the year 0 as 1 BC, for which the database has no date: nobody was born then.
  if (Number(year) < 1) return undefined;
  try {
    return Temporal.PlainDate.from(
      { year: Number(year), month: Number(month), day: Number(day) },
      { overflow: 'reject' },
    ).toString();
  } catch {
    return undefined;
  }
}

/**
 * What a search looks for. A patient matches when every part that is there matches (the words of a
 * name in any order, the digits of a phone number, a date of birth), or when the whole search is
 * their insurance number, which only its blind index can compare.
 */
export interface PatientSearch {
  /** Each word must be in the name. Empty: no search by name. */
  readonly words: readonly string[];
  readonly phoneDigits: string | undefined;
  readonly dateOfBirth: string | undefined;
  /** Normalised like a stored number (BR-10); undefined when the search cannot be one. */
  readonly insuranceNumber: string | undefined;
}

/** Undefined: nothing in it to look for, such as a single letter. */
export function patientSearchOf(input: string): PatientSearch | undefined {
  const words = [
    ...new Set(
      searchTextOf(input)
        .split(' ')
        // A name has no digits: a word with one is part of a date, a phone or an insurance number.
        // Arabic and Latin letters are one code unit each once the marks are gone.
        .filter((word) => word.length >= MIN_NAME_LETTERS && !/\p{Nd}/u.test(word)),
    ),
  ].slice(0, MAX_SEARCH_WORDS);
  // Without the zeros in front: the trunk 0 of a local number and the 00 before a country code are
  // not in a number stored with its country code, and the rest is still in one stored without.
  const digits = asciiDigitsOf(input).replaceAll(/\D/gu, '').replace(/^0+/u, '');
  const dateOfBirth = dateOfSearch(input);
  const phoneDigits =
    dateOfBirth === undefined && digits.length >= MIN_PHONE_DIGITS ? digits : undefined;
  const number = normalizedInsuranceNumber(input);
  const insuranceNumber = number !== undefined && /\d/u.test(number) ? number : undefined;
  if (words.length === 0 && phoneDigits === undefined && dateOfBirth === undefined) {
    return undefined;
  }
  return { words, phoneDigits, dateOfBirth, insuranceNumber };
}

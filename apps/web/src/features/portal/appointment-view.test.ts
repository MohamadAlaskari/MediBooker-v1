import { ApiError, type AppointmentDto, type MyPracticeDto } from '@medibooker/api-client';
import { bookAppointmentBodyPatientNoteRegExp } from '@medibooker/api-client/zod';
import { isolate } from '@medibooker/i18n';
import { describe, expect, it } from 'vitest';
import { practiceFormat } from '@/lib/format';
import {
  formatOf,
  isChoiceGone,
  isId,
  isOutcomeUnknown,
  isPracticeSlug,
  isSafeToRepeat,
  nameInSentence,
  noteToSend,
  phoneInSentence,
  practiceById,
  practiceNames,
  textIn,
  whenParts,
} from './appointment-view';

describe('phoneInSentence', () => {
  it('keeps a number whole, and in its own direction', () => {
    const text = phoneInSentence('+966 11 000 0000');
    expect(text).not.toContain(' ');
    expect(text.normalize('NFKC')).toContain('+966 11 000 0000');
    expect(text.codePointAt(0)).toBe(0x2066);
    expect(text.codePointAt(text.length - 1)).toBe(0x2069);
  });
});

const APPOINTMENT = {
  numberingSystem: 'latn',
  hourCycle: 'h23',
  timeZone: 'Asia/Riyadh',
} as AppointmentDto;

const PRACTICES = [
  { id: 'a', slug: 'al-noor', name: { ar: 'النور', en: 'Al Noor' }, capacity: 'PATIENT' },
  { id: 'b', slug: null, name: {}, capacity: 'PATIENT' },
] as unknown as readonly MyPracticeDto[];

describe('what comes from the address', () => {
  it('takes a slug and an id, and nothing that could lead elsewhere in the API', () => {
    expect(isPracticeSlug('al-noor')).toBe(true);
    expect(isPracticeSlug('..%2Fme')).toBe(false);
    expect(isPracticeSlug('Al_Noor')).toBe(false);
    expect(isId('30000000-0000-4000-8000-000000000001')).toBe(true);
    expect(isId('../me')).toBe(false);
  });
});

describe('textIn', () => {
  it('reads the language asked for, then any there is, then nothing', () => {
    expect(textIn({ ar: 'فحص', en: 'Check-up' }, 'en')).toBe('Check-up');
    expect(textIn({ ar: 'فحص' }, 'en')).toBe('فحص');
    expect(textIn({}, 'en')).toBe('');
  });
});

describe('whenParts', () => {
  it('reads an instant in the zone of the practice, with its year', () => {
    const format = practiceFormat('en', {
      numberingSystem: 'latn',
      hourCycle: 'h23',
      timeZone: 'Asia/Riyadh',
    });
    expect(whenParts(format, '2026-11-10T21:30:00Z')).toEqual({
      date: 'Wednesday, November 11, 2026',
      time: '00:30',
    });
  });

  it('takes the settings of an appointment', () => {
    expect(formatOf(APPOINTMENT, 'en').instantTime('2026-11-10T06:00:00Z')).toBe('09:00');
  });
});

describe('practice names', () => {
  it('finds a practice of the account', () => {
    expect(practiceById(PRACTICES, 'a')?.slug).toBe('al-noor');
    expect(practiceById(PRACTICES, 'x')).toBeUndefined();
    expect(practiceById(undefined, 'a')).toBeUndefined();
  });

  it('names them in one sentence part, each whole, and says something for one without a name', () => {
    expect(practiceNames(['a'], PRACTICES, 'en', 'a practice')).toBe(isolate('Al Noor'));
    expect(practiceNames(['a', 'b', 'x'], PRACTICES, 'en', 'a practice')).toBe(
      `${isolate('Al Noor')}, a practice, and a practice`,
    );
    expect(practiceNames(['a'], undefined, 'en', 'a practice')).toBe('a practice');
  });
});

describe('nameInSentence', () => {
  it('keeps a name in another script whole, as a number at its start would move otherwise', () => {
    expect(nameInSentence('24 Stunden Praxis', 'a practice')).toBe(isolate('24 Stunden Praxis'));
  });

  it.each([[null], [undefined], ['']])('says the fallback for %s', (name) => {
    expect(nameInSentence(name, 'a practice')).toBe('a practice');
  });
});

describe('what a press answers', () => {
  it.each([
    'SLOT_NOT_AVAILABLE',
    'APPOINTMENT_OVERLAP',
    'OUTSIDE_BOOKING_WINDOW',
    'SERVICE_NOT_BOOKABLE',
    'NOT_FOUND',
  ])('%s: only another choice can help', (code) => {
    expect(isChoiceGone(new ApiError({ status: 409, code }))).toBe(true);
  });

  it.each(['RATE_LIMITED', 'BOOKING_LIMIT_REACHED', 'PATIENT_PROFILE_INCOMPLETE'])(
    '%s: says nothing against this choice',
    (code) => {
      expect(isChoiceGone(new ApiError({ status: 409, code }))).toBe(false);
    },
  );

  it('takes nothing else for a choice that has gone', () => {
    expect(isChoiceGone(null)).toBe(false);
    expect(isChoiceGone(new Error('not from the API'))).toBe(false);
  });

  it.each([
    ['a lost connection', new ApiError({ status: 0, code: 'NETWORK_ERROR' })],
    ['a timeout', new ApiError({ status: 0, code: 'TIMEOUT' })],
    ['a failure of the server', new ApiError({ status: 500, code: 'INTERNAL_ERROR' })],
    ['an answer nobody can read', new ApiError({ status: 200, code: 'UNEXPECTED_RESPONSE' })],
    // A busy practice: a connection can fail during the commit too (security review of B06).
    ['a practice that was busy', new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE' })],
    ['a 503 of something in between', new ApiError({ status: 503, code: 'UNEXPECTED_RESPONSE' })],
    ['something else', new Error('not from the API')],
  ])('leaves the outcome open after %s', (_name, error) => {
    expect(isOutcomeUnknown(error)).toBe(true);
  });

  it.each([
    ['no error', null],
    ['a refusal', new ApiError({ status: 409, code: 'SLOT_NOT_AVAILABLE' })],
    ['a limit', new ApiError({ status: 429, code: 'RATE_LIMITED' })],
  ])('knows the outcome after %s', (_name, error) => {
    expect(isOutcomeUnknown(error)).toBe(false);
  });

  it('takes the same press as safe after a busy practice of the API only (B06)', () => {
    expect(isSafeToRepeat(new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE' }))).toBe(true);
    for (const error of [
      null,
      new Error('lost'),
      new ApiError({ status: 503, code: 'UNEXPECTED_RESPONSE' }),
      new ApiError({ status: 500, code: 'INTERNAL_ERROR' }),
      new ApiError({ status: 0, code: 'NETWORK_ERROR' }),
    ]) {
      expect(isSafeToRepeat(error)).toBe(false);
    }
  });
});

describe('noteToSend', () => {
  const char = (...points: readonly number[]): string => String.fromCodePoint(...points);
  const RIGHT_TO_LEFT_MARK = char(0x200f);
  const LEFT_TO_RIGHT_MARK = char(0x200e);
  const SOFT_HYPHEN = char(0xad);
  const ZERO_WIDTH_JOINER = char(0x200d);
  const ZERO_WIDTH_NON_JOINER = char(0x200c);
  const LINE_SEPARATOR = char(0x2028);
  const PARAGRAPH_SEPARATOR = char(0x2029);
  const NO_BREAK_SPACE = char(0xa0);
  const CARRIAGE_RETURN = char(0x0d);
  const TAG_LETTER = char(0xe0041);

  it('leaves what a person writes as it is', () => {
    expect(noteToSend('ألم في الظهر')).toBe('ألم في الظهر');
    expect(noteToSend('first line\nsecond line')).toBe('first line\nsecond line');
  });

  it.each([
    ['a right-to-left mark', `${RIGHT_TO_LEFT_MARK}فحص`, 'فحص'],
    ['a left-to-right mark', `فحص${LEFT_TO_RIGHT_MARK}`, 'فحص'],
    ['a soft hyphen', `fo${SOFT_HYPHEN}o`, 'foo'],
    ['an invisible tag', `foo${TAG_LETTER}`, 'foo'],
    ['a carriage return of a pasted line', `a${CARRIAGE_RETURN}\nb`, 'a\nb'],
  ])('takes out %s, which nobody can see to remove', (_name, written, sent) => {
    expect(noteToSend(written)).toBe(sent);
  });

  it('keeps words apart and lines apart', () => {
    expect(noteToSend('a\tb')).toBe('a b');
    expect(noteToSend(`a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}c`)).toBe('a\nb\nc');
  });

  it('keeps the joiners, which Arabic and Persian text and emoji need', () => {
    const written = `می${ZERO_WIDTH_NON_JOINER}خواهم ${char(0x1f468, 0x200d, 0x2695)}`;
    expect(noteToSend(written)).toBe(written);
    expect(noteToSend(`a${ZERO_WIDTH_JOINER}b`)).toBe(`a${ZERO_WIDTH_JOINER}b`);
  });

  it.each([
    ['nothing', ''],
    ['spaces', '   '],
    ['no-break spaces', `${NO_BREAK_SPACE}${NO_BREAK_SPACE}`],
    ['lines', '\n\n'],
    ['a mark and a space', `${RIGHT_TO_LEFT_MARK} `],
    ['joiners', `${ZERO_WIDTH_JOINER}${ZERO_WIDTH_NON_JOINER}`],
  ])('leaves out a note of only %s, as the field is optional', (_name, written) => {
    expect(noteToSend(written)).toBeUndefined();
  });

  it.each([
    ['pasted Arabic', `${RIGHT_TO_LEFT_MARK}ألم${LEFT_TO_RIGHT_MARK} ${SOFT_HYPHEN}في الظهر\n`],
    ['a tab and separators', `a\tb${LINE_SEPARATOR}c${PARAGRAPH_SEPARATOR}d`],
    ['a broken character', `a${String.fromCharCode(0xd800)}b`],
  ])('sends what the rule of the API takes: %s', (_name, written) => {
    expect(bookAppointmentBodyPatientNoteRegExp.test(noteToSend(written) ?? '')).toBe(true);
  });
});

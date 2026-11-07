import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { BookAppointmentDto } from './appointments.dto.js';

const chr = (...codes: readonly number[]): string => String.fromCodePoint(...codes);
const ZWSP = chr(0x200b);
const ZWNJ = chr(0x200c);
const ZWJ = chr(0x200d);
const WORD_JOINER = chr(0x2060);

function isAccepted(patientNote: string): boolean {
  const dto = plainToInstance(BookAppointmentDto, {
    serviceId: '00000000-0000-4000-8000-000000000001',
    startsAt: '2026-11-16T07:00:00Z',
    patientNote,
  });
  return validateSync(dto).length === 0;
}

describe('BookAppointmentDto, the note', () => {
  it.each([
    ['one line', 'Synthetic note'],
    ['several lines', 'Synthetic\nnote'],
    ['Arabic', 'ملاحظة للعيادة'],
    ['Persian with a joiner that is not one', `می${ZWNJ}خواهم`],
    ['an emoji made with a joiner', `${chr(0x1f468)}${ZWJ}${chr(0x2695, 0xfe0f)}`],
  ])('takes %s', (_, note) => {
    expect(isAccepted(note)).toBe(true);
  });

  it.each([
    ['nothing', ''],
    ['only spaces and lines', ' \n '],
    ['only a zero-width space', ZWSP],
    ['only joiners', `${ZWNJ}${ZWJ}`],
    ['only a word joiner', WORD_JOINER],
    ['a zero-width space inside text', `Syn${ZWSP}thetic`],
    ['text hidden in tag characters', `Synthetic${chr(0xe0041, 0xe0042)}`],
    ['a reading-direction mark', `Synthetic${chr(0x202e)}`],
    ['a carriage return', 'Synthetic\r\nnote'],
    ['another control character', `Synthetic${chr(0x7)}`],
    ['a line separator', `Synthetic${chr(0x2028)}note`],
    ['a paragraph separator', `Synthetic${chr(0x2029)}note`],
    ['a private use character', `Synthetic${chr(0xe000)}`],
    ['an unassigned code point', `Synthetic${chr(0x378)}`],
    ['half of a pair', `Synthetic${String.fromCharCode(0xd83d)}`],
    ['more than 500 characters', 'x'.repeat(501)],
  ])('refuses %s', (_, note) => {
    expect(isAccepted(note)).toBe(false);
  });
});

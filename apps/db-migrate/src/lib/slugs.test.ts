import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPracticeName, RESERVED_SLUGS, slugProblem } from './slugs.ts';

/** `apps/web/src/app/[locale]`, the pages under a language. */
const LOCALE_APP = path.join(import.meta.dirname, '../../../web/src/app/[locale]');

/** The first path segments of the web's pages: folders, through route groups `(...)`. */
function firstSegments(folder: string): readonly string[] {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      if (/^\(.+\)$/.test(entry.name)) return firstSegments(path.join(folder, entry.name));
      // A dynamic segment `[...]` and a private folder `_...` are no fixed path.
      return entry.name.startsWith('[') || entry.name.startsWith('_') ? [] : [entry.name];
    });
}

describe('slugProblem', () => {
  it.each(['al-noor', 'abc', 'praxis-mueller-2', '123', 'a'.repeat(40)])('accepts %s', (slug) => {
    expect(slugProblem(slug)).toBeUndefined();
  });

  it.each([
    'ab',
    'a'.repeat(41),
    'Al-Noor',
    '-al-noor',
    'al-noor-',
    'al_noor',
    'al noor',
    'عيادة',
    'al.noor',
    'al-noor\n',
    '',
  ])('refuses the form of %j', (slug) => {
    expect(slugProblem(slug)).toBe('FORMAT');
  });

  it('refuses every reserved word, which all have the form of a slug', () => {
    for (const word of RESERVED_SLUGS) expect(slugProblem(word)).toBe('RESERVED');
  });

  it('reserves every first path segment of the web, so no page hides a practice', () => {
    const segments = firstSegments(LOCALE_APP);
    expect(segments).toEqual(expect.arrayContaining(['sign-in', 'account', 'dashboard']));
    expect(segments.filter((segment) => !RESERVED_SLUGS.has(segment))).toEqual([]);
  });
});

describe('isPracticeName', () => {
  it.each([
    'مركز النور الطبي',
    'Al Noor Medical Center',
    '  Praxis Dr. Müller  ',
    'ab',
    // ZWNJ, as Persian writes it, and a right-to-left mark
    `کلینیک${String.fromCodePoint(0x200c)}ها`,
    `Clinic ${String.fromCodePoint(0x200f)}2`,
  ])('accepts %j', (name) => {
    expect(isPracticeName(name)).toBe(true);
  });

  it.each([
    '',
    ' ',
    'a',
    'x'.repeat(121),
    'Line\nbreak',
    'Tab\there',
    'Bell\u0007',
    'Next\u0085line',
    `Turned ${String.fromCodePoint(0x202e)}round`,
    `Isolated ${String.fromCodePoint(0x2066)}inside`,
    `Line${String.fromCodePoint(0x2028)}separator`,
    `${String.fromCodePoint(0x200b)}${String.fromCodePoint(0x200b)}`,
    '- !',
  ])('refuses %j', (name) => {
    expect(isPracticeName(name)).toBe(false);
  });
});

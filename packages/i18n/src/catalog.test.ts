import { readFileSync } from 'node:fs';
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { createTranslator } from 'use-intl/core';
import { describe, expect, it } from 'vitest';
import { buildCatalog, buildLocalesJson, localesOf } from '../scripts/generate.ts';
import { isolate, isolateLtr } from './bidi.js';
import { toFormattingLocale } from './format-locale.js';
import { formats } from './formats.js';
import { messages } from './generated/catalog.js';
import { LOCALES } from './locales.js';

interface Tree {
  readonly [key: string]: string | Tree;
}

function flatten(tree: Tree, prefix = ''): ReadonlyMap<string, string> {
  const entries = Object.entries(tree).flatMap(([key, value]): [string, string][] => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    return typeof value === 'string' ? [[path, value]] : [...flatten(value, path)];
  });
  return new Map(entries);
}

const FLAT = LOCALES.map((locale) => ({ locale, flat: flatten(messages[locale]) }));
const CASES = FLAT.flatMap(({ locale, flat }) =>
  [...flat].map(([key, text]) => ({ locale, key, text })),
);

type ArgumentKind = 'number' | 'date' | 'text';

/** The arguments of a message with what each is formatted as, also inside plural branches. */
function argumentsOf(elements: readonly MessageFormatElement[]): ReadonlyMap<string, ArgumentKind> {
  const found = new Map<string, ArgumentKind>();
  for (const element of elements) {
    if (element.type === TYPE.argument) found.set(element.value, 'text');
    if (element.type === TYPE.number) found.set(element.value, 'number');
    if (element.type === TYPE.date || element.type === TYPE.time) found.set(element.value, 'date');
    if (element.type === TYPE.plural || element.type === TYPE.select) {
      if (element.type === TYPE.plural) found.set(element.value, 'number');
      else found.set(element.value, 'text');
      for (const option of Object.values(element.options)) {
        for (const [name, kind] of argumentsOf(option.value)) {
          if (!found.has(name)) found.set(name, kind);
        }
      }
    }
  }
  return found;
}

function pluralsOf(elements: readonly MessageFormatElement[]): readonly (readonly string[])[] {
  return elements.flatMap((element) =>
    element.type === TYPE.plural ? [Object.keys(element.options)] : [],
  );
}

describe('the catalogue (05 §2.3)', () => {
  it('has the same keys in every language', () => {
    const [source] = FLAT;
    for (const { flat } of FLAT) {
      expect([...flat.keys()].sort()).toEqual([...(source?.flat.keys() ?? [])].sort());
    }
  });

  it.each(CASES)('$locale $key parses as ICU and holds no HTML', ({ text }) => {
    expect(() => parse(text)).not.toThrow();
    expect(text).not.toMatch(/<[a-z/]/i);
  });

  it.each(CASES)('$locale $key has the same arguments as the source', ({ key, text }) => {
    const source = flatten(messages.ar).get(key) ?? '';
    expect([...argumentsOf(parse(text)).keys()].sort()).toEqual(
      [...argumentsOf(parse(source)).keys()].sort(),
    );
  });

  it('gives Arabic plurals all six categories', () => {
    for (const text of flatten(messages.ar).values()) {
      for (const categories of pluralsOf(parse(text))) {
        expect([...categories].sort()).toEqual(['few', 'many', 'one', 'other', 'two', 'zero']);
      }
    }
  });

  it('has a message for every code of the server and of the client', () => {
    const document = JSON.parse(
      readFileSync(new URL('../../../apps/api/openapi.json', import.meta.url), 'utf8'),
    ) as {
      components: {
        schemas: { ErrorCode: { enum: string[] }; FieldErrorCode: { enum: string[] } };
      };
    };
    const { ErrorCode, FieldErrorCode } = document.components.schemas;
    for (const { flat } of FLAT) {
      for (const code of [...ErrorCode.enum, 'NETWORK_ERROR', 'TIMEOUT', 'UNEXPECTED_RESPONSE']) {
        expect(flat.has(`errors.${code}`)).toBe(true);
      }
      for (const code of FieldErrorCode.enum) {
        expect(flat.has(`validation.${code}`)).toBe(true);
      }
    }
  });
});

describe('every message with the runtime engine', () => {
  const NUMBERS = [0, 1, 2, 3, 11, 100];

  function valuesFor(text: string, sample: number): Record<string, string | number | Date> {
    return Object.fromEntries(
      [...argumentsOf(parse(text))].map(([name, kind]) => [
        name,
        kind === 'number' ? sample : kind === 'date' ? new Date('2027-03-28T01:30:00Z') : 'x',
      ]),
    );
  }

  it.each(CASES)('$locale $key formats', ({ locale, key, text }) => {
    const translate = createTranslator({
      locale,
      messages: messages[locale],
      formats,
      timeZone: 'Asia/Riyadh',
      onError: (error) => {
        throw error;
      },
    });
    const format = translate as unknown as (
      path: string,
      values: Record<string, string | number | Date>,
    ) => string;
    for (const sample of NUMBERS) {
      expect(format(key, valuesFor(text, sample)).length).toBeGreaterThan(0);
    }
  });
});

describe('the generator', () => {
  it('picks up a new language without a code change', () => {
    const locales = localesOf(['en.json', 'ar.json', 'de.json', 'README.md']);
    expect(locales).toEqual(['ar', 'de', 'en']);
    expect(buildCatalog(locales)).toContain("import de from '../messages/de.json'");
    expect(buildCatalog(locales)).toContain("export const LOCALES = ['ar', 'de', 'en'] as const;");
  });

  it('writes a language with a region under a valid name', () => {
    const catalog = buildCatalog(['ar', 'pt-BR']);
    expect(catalog).toContain("import pt_BR from '../messages/pt-BR.json'");
    expect(catalog).toContain("'pt-BR': pt_BR,");
  });

  it('needs the source language', () => {
    expect(() => localesOf(['en.json'])).toThrow(/ar\.json/);
  });

  it('keeps locales.json equal to LOCALES, for the configs that read it without a build', () => {
    const file = readFileSync(new URL('../locales.json', import.meta.url), 'utf8');
    expect(JSON.parse(file)).toEqual([...LOCALES]);
    expect(file).toBe(buildLocalesJson(LOCALES));
  });

  it('matches the committed catalogue', () => {
    const file = readFileSync(new URL('./generated/catalog.ts', import.meta.url), 'utf8');
    expect(file).toBe(buildCatalog(LOCALES));
  });
});

describe('toFormattingLocale', () => {
  it('adds the practice settings as Unicode extensions', () => {
    expect(toFormattingLocale('ar', { numberingSystem: 'arab', hourCycle: 'h23' })).toBe(
      'ar-u-nu-arab-hc-h23',
    );
    expect(toFormattingLocale('en', { numberingSystem: 'latn' })).toBe('en-u-nu-latn');
    expect(toFormattingLocale('en', { hourCycle: 'h12' })).toBe('en-u-hc-h12');
    expect(toFormattingLocale('en')).toBe('en');
  });

  it('is a locale that Intl follows', () => {
    const locale = toFormattingLocale('ar', { numberingSystem: 'arab', hourCycle: 'h23' });
    const time = new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Riyadh',
    }).format(new Date('2027-03-28T10:30:00Z'));
    expect(time).toBe('١٣:٣٠');
  });
});

describe('isolateLtr', () => {
  it('wraps a Latin snippet in directional isolates', () => {
    expect(isolateLtr('+966 11 000')).toBe('⁦+966 11 000⁩');
  });
});

describe('isolate', () => {
  it('lets the text decide its direction and keeps it out of the sentence', () => {
    expect(isolate('مركز')).toBe('⁨مركز⁩');
  });
});

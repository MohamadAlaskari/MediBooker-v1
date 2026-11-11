import { describe, expect, it } from 'vitest';
import { depthOf, MAX_JSON_DEPTH, refuseDeepJson, refuseReservedKeys } from './json-guards.js';

const NO_REQUEST = undefined as never;

describe('refuseReservedKeys', () => {
  it('refuses the keys class-transformer reads as its own, in any object', () => {
    const parse = (text: string): unknown => JSON.parse(text, refuseReservedKeys) as unknown;
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(() => parse(`{"name":{"${key}":"x"}}`)).toThrow(SyntaxError);
    }
    expect(parse('{"name":{"en":"x"},"note":"constructor"}')).toEqual({
      name: { en: 'x' },
      note: 'constructor',
    });
  });
});

describe('refuseDeepJson', () => {
  const nested = (depth: number): Buffer => Buffer.from(`${'['.repeat(depth)}${']'.repeat(depth)}`);

  it('counts nesting outside strings only, also after escaped quotes', () => {
    expect(depthOf(Buffer.from('{"a":[{"b":"[[[{{{"}],"c":"\\"[["}'))).toBe(3);
    expect(depthOf(Buffer.from('"plain"'))).toBe(0);
  });

  it('lets a body as deep as the limit through, and refuses one level more with 400', () => {
    expect(() => {
      refuseDeepJson(NO_REQUEST, NO_REQUEST, nested(MAX_JSON_DEPTH));
    }).not.toThrow();
    expect(() => {
      refuseDeepJson(NO_REQUEST, NO_REQUEST, nested(MAX_JSON_DEPTH + 1));
    }).toThrow(expect.objectContaining({ status: 400 }));
  });
});

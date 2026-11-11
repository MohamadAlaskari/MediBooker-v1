import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Keys that class-transformer reads as its own when the validation pipe copies a body: with
 * `constructor` a plain value names the class to build, and the copy throws (500 instead of 400).
 * No body of the API has them (security review of M02).
 */
const RESERVED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Deeper than any body of the API. class-transformer copies a body recursively, and a 100 kB body of
 * nested arrays overflows the stack (500); the parser answers 400 before (security review of M02).
 */
export const MAX_JSON_DEPTH = 32;

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPENERS: ReadonlySet<number> = new Set([0x5b, 0x7b]);
const CLOSERS: ReadonlySet<number> = new Set([0x5d, 0x7d]);

/** For `JSON.parse`: a reserved key is a syntax error, which the body parser answers with 400. */
export function refuseReservedKeys(key: string, value: unknown): unknown {
  if (RESERVED_KEYS.has(key)) throw new SyntaxError('reserved key in the body');
  return value;
}

/** The deepest nesting of objects and arrays in a JSON text, outside its strings. */
export function depthOf(body: Uint8Array): number {
  let depth = 0;
  let deepest = 0;
  let inString = false;
  let escaped = false;
  for (const byte of body) {
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === BACKSLASH) escaped = true;
      else if (byte === QUOTE) inString = false;
    } else if (byte === QUOTE) {
      inString = true;
    } else if (OPENERS.has(byte)) {
      depth += 1;
      deepest = Math.max(deepest, depth);
    } else if (CLOSERS.has(byte)) {
      depth -= 1;
    }
  }
  return deepest;
}

/** For the body parser's `verify`: a body nested deeper than `MAX_JSON_DEPTH` is 400. */
export function refuseDeepJson(
  _request: IncomingMessage,
  _response: ServerResponse,
  body: Buffer,
): void {
  if (depthOf(body) > MAX_JSON_DEPTH) {
    throw Object.assign(new Error('body nested too deeply'), {
      status: 400,
      type: 'entity.verify.failed',
    });
  }
}

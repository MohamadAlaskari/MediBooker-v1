import { describe, expect, it } from 'vitest';
import {
  asciiDigits,
  base32Decode,
  base32Encode,
  hotp,
  matchingStep,
  newTotpSecret,
  normalizedCode,
  otpauthUri,
  stepOf,
  TOTP_STEP_SECONDS,
} from './totp.js';

/** The SHA-1 seed of RFC 6238 Appendix B. */
const RFC_SEED = Buffer.from('12345678901234567890', 'ascii');
const RFC_SECRET = base32Encode(RFC_SEED);
const at = (seconds: number): Temporal.Instant =>
  Temporal.Instant.fromEpochMilliseconds(seconds * 1000);

describe('base32', () => {
  it('encodes the test vectors of RFC 4648 §10 without padding', () => {
    const vectors: readonly (readonly [string, string])[] = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(Buffer.from(plain, 'ascii'))).toBe(encoded);
      expect(base32Decode(encoded).toString('ascii')).toBe(plain);
    }
  });

  it('reads lower case, spaces and hyphens as a person types them', () => {
    expect(base32Decode('mzxw 6ytb-oi').toString('ascii')).toBe('foobar');
  });

  it('refuses a character outside the alphabet', () => {
    expect(() => base32Decode('MZXW1')).toThrow('not base32');
  });

  it('makes secrets of 160 bits, a new one each time', () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(newTotpSecret()).not.toBe(secret);
  });
});

describe('hotp and stepOf', () => {
  it('gives the eight-digit codes of RFC 6238 Appendix B for SHA-1', () => {
    const vectors: readonly (readonly [number, string])[] = [
      [59, '94287082'],
      [1_111_111_109, '07081804'],
      [1_111_111_111, '14050471'],
      [1_234_567_890, '89005924'],
      [2_000_000_000, '69279037'],
      [20_000_000_000, '65353130'],
    ];
    for (const [seconds, code] of vectors) {
      expect(hotp(RFC_SEED, stepOf(at(seconds)), 8)).toBe(code);
    }
  });

  it('gives the six-digit codes of RFC 4226 Appendix D by default', () => {
    expect(hotp(RFC_SEED, 0n)).toBe('755224');
    expect(hotp(RFC_SEED, 9n)).toBe('520489');
  });

  it('counts whole steps of 30 seconds since 1970', () => {
    expect(stepOf(at(0))).toBe(0n);
    expect(stepOf(at(TOTP_STEP_SECONDS - 1))).toBe(0n);
    expect(stepOf(at(TOTP_STEP_SECONDS))).toBe(1n);
  });
});

describe('asciiDigits', () => {
  it('turns the ten digits of both Arabic sets into ASCII and leaves the rest', () => {
    const arabic = Array.from({ length: 10 }, (_, digit) => String.fromCodePoint(0x06_60 + digit));
    const extended = Array.from({ length: 10 }, (_, digit) =>
      String.fromCodePoint(0x06_f0 + digit),
    );
    expect(asciiDigits(arabic.join(''))).toBe('0123456789');
    expect(asciiDigits(extended.join(''))).toBe('0123456789');
    expect(asciiDigits('ab-12 x')).toBe('ab-12 x');
  });
});

describe('normalizedCode', () => {
  it('takes six digits, also with spaces', () => {
    expect(normalizedCode('123456')).toBe('123456');
    expect(normalizedCode(' 123 456 ')).toBe('123456');
  });

  it('reads the digits an Arabic keyboard types, of both kinds', () => {
    const digits = (zero: number): string =>
      [1, 2, 3, 4, 5, 6].map((digit) => String.fromCodePoint(zero + digit)).join('');
    expect(normalizedCode(digits(0x06_60))).toBe('123456');
    expect(normalizedCode(digits(0x06_f0))).toBe('123456');
    expect(normalizedCode(`${digits(0x06_60).slice(0, 3)} 456`)).toBe('123456');
  });

  it('refuses anything else', () => {
    for (const input of ['', '12345', '1234567', '12a456', '12³456']) {
      expect(normalizedCode(input)).toBeUndefined();
    }
  });
});

describe('matchingStep', () => {
  const now = at(1_234_567_890);
  const current = stepOf(now);
  const codeAt = (step: bigint): string => hotp(RFC_SEED, step);

  it('accepts the code of now and of the step before and after', () => {
    expect(matchingStep(RFC_SECRET, codeAt(current), now, null)).toBe(current);
    expect(matchingStep(RFC_SECRET, codeAt(current - 1n), now, null)).toBe(current - 1n);
    expect(matchingStep(RFC_SECRET, codeAt(current + 1n), now, null)).toBe(current + 1n);
  });

  it('refuses a code two steps away', () => {
    expect(matchingStep(RFC_SECRET, codeAt(current - 2n), now, null)).toBeUndefined();
    expect(matchingStep(RFC_SECRET, codeAt(current + 2n), now, null)).toBeUndefined();
  });

  it('refuses a code of a step that was accepted already, or of one before it', () => {
    expect(matchingStep(RFC_SECRET, codeAt(current), now, current)).toBeUndefined();
    expect(matchingStep(RFC_SECRET, codeAt(current - 1n), now, current)).toBeUndefined();
    expect(matchingStep(RFC_SECRET, codeAt(current + 1n), now, current)).toBe(current + 1n);
  });

  it('refuses what has not the form of a code, and another secret', () => {
    expect(matchingStep(RFC_SECRET, 'abcdef', now, null)).toBeUndefined();
    expect(matchingStep(newTotpSecret(), codeAt(current), now, null)).toBeUndefined();
  });
});

describe('otpauthUri', () => {
  it('names the practice and the account, with the parameters every app reads', () => {
    const uri = new URL(
      otpauthUri({ secret: 'ABCDEF', account: 'staff@example.test', issuer: 'مركز النور' }),
    );
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/مركز النور:staff@example.test');
    expect(Object.fromEntries(uri.searchParams)).toEqual({
      secret: 'ABCDEF',
      issuer: 'مركز النور',
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
  });
});

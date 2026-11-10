import { describe, expect, it } from 'vitest';
import { newRecoveryCodes, normalizedRecoveryCode, RECOVERY_CODE_COUNT } from './recovery-codes.js';

describe('newRecoveryCodes', () => {
  it('makes ten different codes of two halves without look-alike characters', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
  });
});

describe('normalizedRecoveryCode', () => {
  it('reads a code as shown, typed in capitals or without the hyphen', () => {
    expect(normalizedRecoveryCode('abcde-fghjk')).toBe('abcdefghjk');
    expect(normalizedRecoveryCode(' ABCDE FGHJK ')).toBe('abcdefghjk');
    expect(normalizedRecoveryCode('abcdefghjk')).toBe('abcdefghjk');
  });

  it('reads digits typed on an Arabic keyboard', () => {
    const arabic = (digit: number): string => String.fromCodePoint(0x06_60 + digit);
    expect(normalizedRecoveryCode(`abc${arabic(2)}${arabic(3)}-fghjk`)).toBe('abc23fghjk');
  });

  it('refuses what cannot be one', () => {
    for (const input of ['', 'abcde', 'abcde-fghjkm', 'abcde-fghj1', '123456']) {
      expect(normalizedRecoveryCode(input)).toBeUndefined();
    }
  });
});

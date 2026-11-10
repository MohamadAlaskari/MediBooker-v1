import { randomInt } from 'node:crypto';
import { asciiDigits } from './totp.js';

/** How many recovery codes a second factor gets; a new set replaces the old one. */
export const RECOVERY_CODE_COUNT = 10;
/** Letters and digits that cannot be read as another: no 0, 1, i, l or o. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const HALF = 5;
/** Ten characters of 31: about 49 bits, stored only as a keyed hash. */
const RECOVERY_CODE = new RegExp(`^[${ALPHABET}]{${String(HALF * 2)}}$`);

function newRecoveryCode(): string {
  let code = '';
  for (let index = 0; index < HALF * 2; index += 1) {
    code += ALPHABET.charAt(randomInt(ALPHABET.length));
  }
  return `${code.slice(0, HALF)}-${code.slice(HALF)}`;
}

/** A new set, as the person sees it once: `abcde-fghjk`. */
export function newRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, newRecoveryCode);
}

/**
 * The form a code is hashed in: without spaces and hyphens, in lower case. Undefined: it cannot be
 * one, so it is not looked up.
 */
export function normalizedRecoveryCode(input: string): string | undefined {
  const code = asciiDigits(input).replaceAll(/[\s-]/g, '').toLowerCase();
  return RECOVERY_CODE.test(code) ? code : undefined;
}

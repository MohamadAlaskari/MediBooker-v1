import { BREACHED_PASSWORDS } from './breached-passwords.js';

/** ADR 0004 §4 for patients; A04 adds 12 for staff. No composition rules, paste allowed. */
export const MIN_PASSWORD_LENGTH = 10;
/** Long passphrases are welcome; this only keeps the work of hashing bounded. */
export const MAX_PASSWORD_LENGTH = 1024;

/** Whether a password is on the bundled list, with no third-party call (ADR 0004 §4). */
export function isBreachedPassword(password: string): boolean {
  return BREACHED_PASSWORDS.has(password.normalize('NFKC').toLowerCase());
}

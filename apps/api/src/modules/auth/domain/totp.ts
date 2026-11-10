import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238) with what every authenticator app reads without asking:
 * HMAC-SHA-1, six digits and steps of 30 seconds. Pure, apart from the random secret.
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** RFC 4226 §4 asks for at least 128 bits and recommends 160. */
const SECRET_BYTES = 20;
/** A code of the step before or after also counts: a clock a little off, a slow typist. */
const DRIFT_STEPS = 1n;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CODE = /^\d{6}$/;

/** RFC 4648 base32 without padding, as an app reads the secret of a QR code. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let text = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      text += BASE32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) text += BASE32.charAt((value << (5 - bits)) & 31);
  return text;
}

/** The bytes of a base32 text; spaces, hyphens and the case do not matter. Throws on other text. */
export function base32Decode(text: string): Buffer {
  const clean = text.replaceAll(/[\s-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    const index = BASE32.indexOf(character);
    if (index === -1) throw new Error('not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new secret for an authenticator app, in base32. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** The time step of an instant: whole steps since 1970 (RFC 6238 §4.2). */
export function stepOf(instant: Temporal.Instant): bigint {
  return BigInt(Math.floor(instant.epochMilliseconds / 1000 / TOTP_STEP_SECONDS));
}

/** HOTP (RFC 4226 §5.3) for a counter, with dynamic truncation. */
export function hotp(secret: Uint8Array, counter: bigint, digits: number = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = (digest.at(-1) ?? 0) & 15;
  const binary = digest.readUInt32BE(offset) & 0x7f_ff_ff_ff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

const ARABIC_INDIC_ZERO = 0x06_60;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06_f0;

/** Arabic-Indic and Extended Arabic-Indic digits as ASCII digits, as an Arabic keyboard types them. */
export function asciiDigits(input: string): string {
  let text = '';
  for (const character of input) {
    const point = character.codePointAt(0) ?? 0;
    if (point >= ARABIC_INDIC_ZERO && point <= ARABIC_INDIC_ZERO + 9) {
      text += String(point - ARABIC_INDIC_ZERO);
    } else if (point >= EXTENDED_ARABIC_INDIC_ZERO && point <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      text += String(point - EXTENDED_ARABIC_INDIC_ZERO);
    } else {
      text += character;
    }
  }
  return text;
}

/** Whether a text has the form of a code; what a person typed is cleaned first. */
export function normalizedCode(input: string): string | undefined {
  const code = asciiDigits(input).replaceAll(/\s/g, '');
  return CODE.test(code) ? code : undefined;
}

function sameCode(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * The step a code belongs to, close to now and after the last step accepted, so that a code counts
 * once (RFC 6238 §5.2). Undefined: it matches none. Every candidate is computed and compared, so
 * the time taken does not tell which one matched.
 */
export function matchingStep(
  secret: string,
  input: string,
  now: Temporal.Instant,
  lastStep: bigint | null,
): bigint | undefined {
  const code = normalizedCode(input);
  if (code === undefined) return undefined;
  const key = base32Decode(secret);
  const current = stepOf(now);
  let found: bigint | undefined;
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step += 1n) {
    const fresh = lastStep === null || step > lastStep;
    if (sameCode(hotp(key, step), code) && fresh && found === undefined) found = step;
  }
  return found;
}

export interface OtpAuthTarget {
  readonly secret: string;
  /** Who it is for, as the app lists it: the e-mail address of the account. */
  readonly account: string;
  /** Where it belongs, as the app lists it: the practice. */
  readonly issuer: string;
}

/** The text of the QR code an authenticator app scans (the Key Uri Format of Google Authenticator). */
export function otpauthUri({ secret, account, issuer }: OtpAuthTarget): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

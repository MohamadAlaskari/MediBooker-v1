import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

/** The iteration count PostgreSQL uses by default (scram_iterations) and RFC 7677's example. */
export const SCRAM_ITERATIONS = 4096;

const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/**
 * The SCRAM-SHA-256 verifier of a password in PostgreSQL's format
 * `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>` (RFC 5802, RFC 7677). Roles get
 * their password only as such a verifier (CREATE ROLE ... PASSWORD '<verifier>'), so the password
 * itself never reaches the server, its log or its statistics (ADR 0005 §4.6).
 *
 * PostgreSQL normalises a password with SASLprep, which leaves pure ASCII unchanged, so only
 * printable ASCII is accepted: every generated secret is base64url.
 */
export function scramSha256Verifier(password: string, salt: Buffer = randomBytes(16)): string {
  if (!PRINTABLE_ASCII.test(password)) {
    throw new TypeError('a SCRAM password must be non-empty printable ASCII');
  }
  const saltedPassword = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, 'sha256');
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', saltedPassword).update('Server Key').digest();
  return `SCRAM-SHA-256$${String(SCRAM_ITERATIONS)}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

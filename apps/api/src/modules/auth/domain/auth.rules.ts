/** The rules of signing in and of refresh tokens (ADR 0004). Pure. */

/** Failed sign-ins in a row before an account waits, and the longest wait. */
const FREE_FAILURES = 5;
const MAX_LOCK_MINUTES = 60;

/**
 * Until when an account waits after this many failures: 1 minute after the fifth, doubling up to an
 * hour. Undefined: not yet. It slows down guessing, and a sign-in during the wait gets the same
 * generic error. A stranger can keep an account waiting, and a new password ends that (A04 decays
 * the count).
 */
export function lockedUntilAfter(
  failures: number,
  now: Temporal.Instant,
): Temporal.Instant | undefined {
  if (failures < FREE_FAILURES) return undefined;
  const minutes = Math.min(2 ** (failures - FREE_FAILURES), MAX_LOCK_MINUTES);
  return now.add({ minutes });
}

/**
 * How long a rotated token still counts as a race and not as theft: two tabs refreshing at once, or
 * a response that got lost. The loser gets a 401 and nothing else, and uses the newer cookie.
 */
const RACE_SECONDS = 10;

export interface RefreshedSessionState {
  readonly expiresAt: Temporal.Instant;
  readonly rotatedAt: Temporal.Instant | null;
  readonly revokedAt: Temporal.Instant | null;
}

export type RefreshDecision = 'ROTATE' | 'REJECT' | 'RACE' | 'REUSE';

/** What a presented refresh token means: only REUSE revokes its whole family. */
export function refreshDecision(
  { expiresAt, rotatedAt, revokedAt }: RefreshedSessionState,
  now: Temporal.Instant,
): RefreshDecision {
  if (revokedAt !== null || Temporal.Instant.compare(expiresAt, now) <= 0) return 'REJECT';
  if (rotatedAt === null) return 'ROTATE';
  const age = rotatedAt.until(now).total('seconds');
  return age <= RACE_SECONDS ? 'RACE' : 'REUSE';
}

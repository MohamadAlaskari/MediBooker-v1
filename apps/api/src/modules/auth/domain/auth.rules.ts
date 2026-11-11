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

/**
 * How long a session with both factors goes without a refresh before it ends (M05, 03 §5). The
 * dashboard signs out after 15 minutes without activity while its tab is open; a closed tab or a
 * sleeping computer ends here, when its token comes back. An access token lasts 15 minutes and the
 * dashboard asks the API on activity, so a session in use refreshes well within this.
 */
export const SECOND_FACTOR_IDLE_MINUTES = 30;

export interface RefreshedSessionState {
  readonly expiresAt: Temporal.Instant;
  readonly rotatedAt: Temporal.Instant | null;
  readonly revokedAt: Temporal.Instant | null;
  /** When this token was issued: at the sign-in, or at the refresh before. */
  readonly createdAt: Temporal.Instant;
  /** Signed in with both factors (`amr` holds `otp`). */
  readonly secondFactor: boolean;
}

export type RefreshDecision = 'ROTATE' | 'REJECT' | 'RACE' | 'REUSE' | 'IDLE';

/**
 * What a presented refresh token means: REUSE revokes its whole family, and so does IDLE, a session
 * with both factors that went more than SECOND_FACTOR_IDLE_MINUTES without a refresh.
 */
export function refreshDecision(
  { expiresAt, rotatedAt, revokedAt, createdAt, secondFactor }: RefreshedSessionState,
  now: Temporal.Instant,
): RefreshDecision {
  if (revokedAt !== null || Temporal.Instant.compare(expiresAt, now) <= 0) return 'REJECT';
  if (rotatedAt === null) {
    const idle = createdAt.until(now).total('minutes') > SECOND_FACTOR_IDLE_MINUTES;
    return secondFactor && idle ? 'IDLE' : 'ROTATE';
  }
  const age = rotatedAt.until(now).total('seconds');
  return age <= RACE_SECONDS ? 'RACE' : 'REUSE';
}

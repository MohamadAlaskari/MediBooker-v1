/** The rules of signing in and of refresh tokens (ADR 0004). Pure. */

/** Failed sign-ins in a row before an account waits, and the longest wait. */
const FREE_FAILURES = 5;
const MAX_LOCK_MINUTES = 60;

/**
 * Until when the clients of a count wait after this many failures: 1 minute after the fifth, doubling
 * up to an hour. Undefined: not yet. It slows down guessing, and a sign-in during the wait gets the
 * same generic error. A browser the account knows keeps its own count, so a stranger's guesses never
 * make it wait (the security review of A04 part 2b); a success or a new password clears a count.
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
 * One failed sign-in stops counting for every this many minutes since the last (A04): as long as the
 * longest wait, so a stranger who guesses whenever a wait ends gets about 24 guesses a day.
 */
export const FAILURE_DECAY_MINUTES = 60;

/**
 * The failed sign-ins in a row that still count now: one fewer for every FAILURE_DECAY_MINUTES since
 * the last one (the security reviews of A01 to A03 and of A04 part 2b). A burst still makes the
 * clients of a count wait, but one guess an hour never does. A count without a time, from before A04,
 * stands as it is.
 */
export function decayedFailures(
  failures: number,
  lastFailedAt: Temporal.Instant | null,
  now: Temporal.Instant,
): number {
  if (lastFailedAt === null) return failures;
  const minutes = Math.max(0, lastFailedAt.until(now).total('minutes'));
  return Math.max(0, failures - Math.floor(minutes / FAILURE_DECAY_MINUTES));
}

/**
 * Failed sign-ins of clients the account does not know since its last success or new password, after
 * which only a new password lets them in again (NIST SP 800-63B §5.2.2: at most 100). It does not
 * decay, so it bounds what a stranger can ever guess; a browser the account knows is not held by it.
 */
export const MAX_FAILURES_SINCE_SUCCESS = 100;

/** Whether the account takes no more passwords from clients it does not know. */
export function capReached(failuresSinceSuccess: number): boolean {
  return failuresSinceSuccess >= MAX_FAILURES_SINCE_SUCCESS;
}

/** How long one sign-in lasts at most, however often it is refreshed (A04): then sign in again. */
export const FAMILY_MAX_DAYS = 90;

/** The absolute end of a family, from its sign-in. */
export function familyEndOf(familyStartedAt: Temporal.Instant): Temporal.Instant {
  return familyStartedAt.add({ hours: FAMILY_MAX_DAYS * 24 });
}

/** When a new refresh token expires: after its own lifetime, but never after its family's end. */
export function tokenExpiryOf(
  now: Temporal.Instant,
  tokenSeconds: number,
  familyStartedAt: Temporal.Instant,
): Temporal.Instant {
  const own = now.add({ seconds: tokenSeconds });
  const end = familyEndOf(familyStartedAt);
  return Temporal.Instant.compare(own, end) <= 0 ? own : end;
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
  /** The sign-in of its family (its own creation for a row from before A04). */
  readonly familyStartedAt: Temporal.Instant;
  /** Signed in with both factors (`amr` holds `otp`). */
  readonly secondFactor: boolean;
}

export type RefreshDecision = 'ROTATE' | 'REJECT' | 'RACE' | 'REUSE' | 'IDLE';

/**
 * What a presented refresh token means: REUSE revokes its whole family, and so does IDLE, a session
 * with both factors that went more than SECOND_FACTOR_IDLE_MINUTES without a refresh. A family past
 * its absolute end (FAMILY_MAX_DAYS) is REJECT, whatever its token says.
 */
export function refreshDecision(
  {
    expiresAt,
    rotatedAt,
    revokedAt,
    createdAt,
    familyStartedAt,
    secondFactor,
  }: RefreshedSessionState,
  now: Temporal.Instant,
): RefreshDecision {
  if (revokedAt !== null || Temporal.Instant.compare(expiresAt, now) <= 0) return 'REJECT';
  if (Temporal.Instant.compare(familyEndOf(familyStartedAt), now) <= 0) return 'REJECT';
  if (rotatedAt === null) {
    const idle = createdAt.until(now).total('minutes') > SECOND_FACTOR_IDLE_MINUTES;
    return secondFactor && idle ? 'IDLE' : 'ROTATE';
  }
  const age = rotatedAt.until(now).total('seconds');
  return age <= RACE_SECONDS ? 'RACE' : 'REUSE';
}

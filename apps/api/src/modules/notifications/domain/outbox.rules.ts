/** When a queued e-mail is tried again (A02). Pure. */

/** After this many attempts a message counts as failed: 1 + 2 + 4 + 8 minutes of waiting. */
export const MAX_ATTEMPTS = 5;

/** How long a run keeps a row it is sending, should it stop before it says how that went. */
export const LEASE_MINUTES = 5;

/** The next attempt after this many, or undefined when there is none. */
export function nextAttemptAfter(
  attempts: number,
  now: Temporal.Instant,
): Temporal.Instant | undefined {
  if (attempts >= MAX_ATTEMPTS) return undefined;
  return now.add({ minutes: 2 ** (attempts - 1) });
}

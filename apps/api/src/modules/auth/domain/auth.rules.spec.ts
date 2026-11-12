import { describe, expect, it } from 'vitest';
import {
  capReached,
  decayedFailures,
  familyEndOf,
  lockedUntilAfter,
  MAX_FAILURES_SINCE_SUCCESS,
  refreshDecision,
  tokenExpiryOf,
} from './auth.rules.js';

const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const later = (seconds: number): Temporal.Instant => NOW.add({ seconds });

describe('lockedUntilAfter', () => {
  it('lets four failures pass', () => {
    expect(lockedUntilAfter(4, NOW)).toBeUndefined();
  });

  it.each([
    [5, 1],
    [6, 2],
    [7, 4],
    [10, 32],
    [11, 60],
    [50, 60],
  ])('after %i failures waits %i minutes', (failures, minutes) => {
    expect(lockedUntilAfter(failures, NOW)?.equals(NOW.add({ minutes }))).toBe(true);
  });
});

describe('decayedFailures', () => {
  const minutesAgo = (minutes: number): Temporal.Instant => NOW.subtract({ minutes });

  it('forgets one failure for every hour since the last one', () => {
    expect(decayedFailures(11, minutesAgo(0), NOW)).toBe(11);
    expect(decayedFailures(11, minutesAgo(59), NOW)).toBe(11);
    expect(decayedFailures(11, minutesAgo(60), NOW)).toBe(10);
    expect(decayedFailures(11, minutesAgo(240), NOW)).toBe(7);
    expect(decayedFailures(3, minutesAgo(600), NOW)).toBe(0);
  });

  it('keeps a count without a time, from before A04', () => {
    expect(decayedFailures(9, null, NOW)).toBe(9);
  });

  it('lets one guess an hour never make an account wait', () => {
    let failures = 0;
    let last: Temporal.Instant | null = null;
    for (let hour = 0; hour < 48; hour += 1) {
      const at = NOW.add({ hours: hour });
      failures = decayedFailures(failures, last, at) + 1;
      last = at;
      expect(lockedUntilAfter(failures, at)).toBeUndefined();
    }
  });

  it('gives a stranger who guesses whenever a wait ends about 24 guesses a day', () => {
    let failures = 0;
    let last: Temporal.Instant | null = null;
    let at = NOW;
    let guesses = 0;
    const end = NOW.add({ hours: 10 * 24 });
    while (Temporal.Instant.compare(at, end) < 0) {
      failures = decayedFailures(failures, last, at) + 1;
      last = at;
      guesses += 1;
      at = lockedUntilAfter(failures, at) ?? at.add({ seconds: 1 });
    }
    // The first hours' burst, then one an hour (the security review of A04 part 2b: not 96).
    expect(guesses / 10).toBeGreaterThan(24);
    expect(guesses / 10).toBeLessThan(26);
  });
});

describe('capReached', () => {
  it('takes no more passwords from unknown clients after 100 failures since the last success', () => {
    expect(MAX_FAILURES_SINCE_SUCCESS).toBe(100);
    expect(capReached(99)).toBe(false);
    expect(capReached(100)).toBe(true);
  });
});

describe('family lifetime', () => {
  it('ends a family 90 days after its sign-in', () => {
    expect(familyEndOf(NOW).equals(NOW.add({ hours: 90 * 24 }))).toBe(true);
  });

  it('gives a new token its own lifetime, but never past the end of its family', () => {
    const thirtyDays = 30 * 86_400;
    expect(tokenExpiryOf(NOW, thirtyDays, NOW).equals(NOW.add({ seconds: thirtyDays }))).toBe(true);
    const startedLongAgo = NOW.subtract({ hours: 80 * 24 });
    expect(tokenExpiryOf(NOW, thirtyDays, startedLongAgo).equals(familyEndOf(startedLongAgo))).toBe(
      true,
    );
  });
});

describe('refreshDecision', () => {
  const live = {
    expiresAt: later(3600),
    rotatedAt: null,
    revokedAt: null,
    createdAt: later(-60),
    familyStartedAt: later(-60),
    secondFactor: false,
  };

  it('rotates a live token', () => {
    expect(refreshDecision(live, NOW)).toBe('ROTATE');
  });

  it('ends a session with both factors that went more than 30 minutes without a refresh', () => {
    const team = { ...live, secondFactor: true };
    expect(refreshDecision({ ...team, createdAt: later(-30 * 60) }, NOW)).toBe('ROTATE');
    expect(refreshDecision({ ...team, createdAt: later(-30 * 60 - 1) }, NOW)).toBe('IDLE');
    // A patient's session keeps its days (RT-94); a rotated token stays a race or a reuse.
    expect(refreshDecision({ ...live, createdAt: later(-31 * 60) }, NOW)).toBe('ROTATE');
    expect(
      refreshDecision({ ...team, createdAt: later(-31 * 60), rotatedAt: later(-5) }, NOW),
    ).toBe('RACE');
  });

  it('rejects a revoked token, also when it was rotated long ago', () => {
    expect(refreshDecision({ ...live, revokedAt: later(-1) }, NOW)).toBe('REJECT');
    expect(refreshDecision({ ...live, revokedAt: later(-1), rotatedAt: later(-3600) }, NOW)).toBe(
      'REJECT',
    );
  });

  it('rejects an expired token, at the exact moment too', () => {
    expect(refreshDecision({ ...live, expiresAt: NOW }, NOW)).toBe('REJECT');
  });

  it('takes a rotation of the last ten seconds for a race', () => {
    expect(refreshDecision({ ...live, rotatedAt: later(-10) }, NOW)).toBe('RACE');
  });

  it('takes anything older for reuse', () => {
    expect(refreshDecision({ ...live, rotatedAt: later(-11) }, NOW)).toBe('REUSE');
  });

  it('rejects a family past its end, whatever its token says', () => {
    const started = NOW.subtract({ hours: 90 * 24 });
    expect(refreshDecision({ ...live, familyStartedAt: started }, NOW)).toBe('REJECT');
    expect(refreshDecision({ ...live, familyStartedAt: started.add({ seconds: 1 }) }, NOW)).toBe(
      'ROTATE',
    );
  });
});

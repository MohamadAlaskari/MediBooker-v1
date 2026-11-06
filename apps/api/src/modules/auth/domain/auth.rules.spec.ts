import { describe, expect, it } from 'vitest';
import { lockedUntilAfter, refreshDecision } from './auth.rules.js';

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

describe('refreshDecision', () => {
  const live = { expiresAt: later(3600), rotatedAt: null, revokedAt: null };

  it('rotates a live token', () => {
    expect(refreshDecision(live, NOW)).toBe('ROTATE');
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
});

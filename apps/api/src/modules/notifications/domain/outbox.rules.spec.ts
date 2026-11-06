import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, nextAttemptAfter } from './outbox.rules.js';

const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');

describe('nextAttemptAfter', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 8],
  ])('after attempt %i waits %i minutes', (attempts, minutes) => {
    expect(nextAttemptAfter(attempts, NOW)?.equals(NOW.add({ minutes }))).toBe(true);
  });

  it('gives up at the last attempt', () => {
    expect(nextAttemptAfter(MAX_ATTEMPTS, NOW)).toBeUndefined();
  });
});

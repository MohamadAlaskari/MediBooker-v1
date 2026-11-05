import { describe, expect, it } from 'vitest';
import { FixedClock } from './fixed-clock.js';
import { SystemClock } from './system-clock.js';

const START = Temporal.Instant.from('2026-11-16T05:00:00Z');

describe('FixedClock', () => {
  it('stands still until it is moved', () => {
    const clock = new FixedClock(START);
    expect(clock.now()).toEqual(START);
    expect(clock.now()).toEqual(START);
  });

  it('advances by a duration and can be set to an instant', () => {
    const clock = new FixedClock(START);
    clock.advance({ milliseconds: 60_000 });
    expect(clock.now().toString()).toBe('2026-11-16T05:01:00Z');
    clock.set(Temporal.Instant.from('2027-03-28T01:00:00Z'));
    expect(clock.now().toString()).toBe('2027-03-28T01:00:00Z');
  });
});

describe('SystemClock', () => {
  it('reads the current instant', () => {
    const before = Temporal.Now.instant();
    const now = new SystemClock().now();
    expect(Temporal.Instant.compare(now, before)).toBeGreaterThanOrEqual(0);
  });
});

import { Clock } from './clock.js';

/**
 * A clock that stands still until a test moves it, so caches and evictions with a lifetime
 * (`evictIdle()`, `PracticeCache`) are tested by stepping time instead of waiting (06 §3). Waiting
 * itself is tested with fake timers, never with this clock.
 */
export class FixedClock extends Clock {
  constructor(private instant: Temporal.Instant) {
    super();
  }

  now(): Temporal.Instant {
    return this.instant;
  }

  set(instant: Temporal.Instant): void {
    this.instant = instant;
  }

  advance(duration: Temporal.DurationLike): void {
    this.instant = this.instant.add(duration);
  }
}

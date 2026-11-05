/**
 * The current instant (02 §4). Code that depends on time takes the injected Clock instead of
 * reading the system clock, so tests control "now": `SystemClock` in the app, `FixedClock` in
 * tests (and, from P02, with CLOCK_FIXED_AT in local and ci runs). The conversion between
 * Prisma's `Date` and `Temporal.Instant` (`convert.ts`) arrives with P02.
 */
export abstract class Clock {
  abstract now(): Temporal.Instant;
}

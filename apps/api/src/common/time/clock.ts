/**
 * The current instant (02 §4). Code that depends on time takes the injected Clock instead of
 * reading the system clock, so tests control "now": `SystemClock` in the app, `FixedClock` in
 * tests. The conversions between Prisma's `Date` and Temporal are in `convert.ts`.
 */
export abstract class Clock {
  abstract now(): Temporal.Instant;
}

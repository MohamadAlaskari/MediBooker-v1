/**
 * The conversions between Prisma's `Date` and Temporal (02 §4). A `@db.Date` column arrives as a
 * `Date` at midnight UTC and is written the same way, so a date never moves with a time zone.
 */

/** A `@db.Date` value as a practice-local calendar date. */
export function plainDateOf(date: Date): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime())
    .toZonedDateTimeISO('UTC')
    .toPlainDate();
}

/** A calendar date as the value of a `@db.Date` column. */
export function dbDateOf(date: Temporal.PlainDate): Date {
  return new Date(date.toZonedDateTime('UTC').epochMilliseconds);
}

/**
 * The rules of time for slots (BR-03, BR-06, BR-15, ADR 0014). Pure: rules are local wall-clock
 * times in the practice's zone, slots are instants, and windows count elapsed time.
 */

export interface SlotRule {
  readonly id: string;
  readonly providerId: string;
  /** ISO weekday: 1 Monday to 7 Sunday. */
  readonly weekday: number;
  /** Minutes after local midnight. */
  readonly startMinute: number;
  readonly endMinute: number;
  readonly slotMinutes: number;
  readonly validFrom: Temporal.PlainDate;
  /** Inclusive; null: open-ended. */
  readonly validTo: Temporal.PlainDate | null;
}

export interface ProviderAbsence {
  readonly providerId: string;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
}

export interface SlotGenerationInput {
  readonly rules: readonly SlotRule[];
  readonly absences: readonly ProviderAbsence[];
  /** ISO dates of the special days on which the practice is closed. */
  readonly closedDays: ReadonlySet<string>;
  /** ISO weekdays. */
  readonly weekendDays: readonly number[];
  readonly timeZone: string;
  readonly from: Temporal.PlainDate;
  /** Inclusive. */
  readonly to: Temporal.PlainDate;
}

export interface GeneratedSlot {
  readonly ruleId: string;
  readonly providerId: string;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
}

function appliesOn(rule: SlotRule, date: Temporal.PlainDate): boolean {
  return (
    rule.weekday === date.dayOfWeek &&
    Temporal.PlainDate.compare(rule.validFrom, date) <= 0 &&
    (rule.validTo === null || Temporal.PlainDate.compare(date, rule.validTo) <= 0)
  );
}

/**
 * The instant of a local time. Asked for the earlier of two, the zone answers a time that occurs
 * twice with its first occurrence, and a time that does not exist with one before the gap: a wall
 * clock other than the one asked for means that it does not exist.
 */
function instantOfLocalTime(
  date: Temporal.PlainDate,
  minute: number,
  timeZone: string,
): Temporal.Instant | undefined {
  const local = date.toPlainDateTime(new Temporal.PlainTime(Math.floor(minute / 60), minute % 60));
  const zoned = local.toZonedDateTime(timeZone, { disambiguation: 'earlier' });
  return zoned.toPlainDateTime().equals(local) ? zoned.toInstant() : undefined;
}

function overlapsAbsence(
  absences: readonly ProviderAbsence[],
  slot: Omit<GeneratedSlot, 'ruleId'>,
): boolean {
  return absences.some(
    (absence) =>
      absence.providerId === slot.providerId &&
      Temporal.Instant.compare(slot.startsAt, absence.endsAt) < 0 &&
      Temporal.Instant.compare(absence.startsAt, slot.endsAt) < 0,
  );
}

function slotsOfRuleOn(
  rule: SlotRule,
  date: Temporal.PlainDate,
  { absences, timeZone }: SlotGenerationInput,
): GeneratedSlot[] {
  const slots: GeneratedSlot[] = [];
  const { id: ruleId, providerId, startMinute, endMinute, slotMinutes } = rule;
  for (let minute = startMinute; minute + slotMinutes <= endMinute; minute += slotMinutes) {
    const startsAt = instantOfLocalTime(date, minute, timeZone);
    if (startsAt === undefined) continue;
    const slot = { providerId, startsAt, endsAt: startsAt.add({ minutes: slotMinutes }) };
    if (!overlapsAbsence(absences, slot)) slots.push({ ...slot, ruleId });
  }
  return slots;
}

/**
 * The slots of a date range: not on weekend days, closed special days or in a provider's absence.
 * A local time that does not exist is skipped, and one that occurs twice gives one slot, at its
 * first occurrence (BR-15).
 */
export function generateSlots(input: SlotGenerationInput): GeneratedSlot[] {
  const { rules, closedDays, weekendDays, from, to } = input;
  const slots: GeneratedSlot[] = [];
  for (let date = from; Temporal.PlainDate.compare(date, to) <= 0; date = date.add({ days: 1 })) {
    if (weekendDays.includes(date.dayOfWeek) || closedDays.has(date.toString())) continue;
    for (const rule of rules) {
      if (appliesOn(rule, date)) slots.push(...slotsOfRuleOn(rule, date, input));
    }
  }
  return slots;
}

export interface InstantRange {
  readonly start: Temporal.Instant;
  /** Exclusive. */
  readonly end: Temporal.Instant;
}

/**
 * A practice-local day as instants. It starts at its first existing time, which is not always
 * 00:00, and lasts 23 or 25 hours when the clocks change.
 */
export function dayRange(date: Temporal.PlainDate, timeZone: string): InstantRange {
  return {
    start: date.toZonedDateTime(timeZone).toInstant(),
    end: date.add({ days: 1 }).toZonedDateTime(timeZone).toInstant(),
  };
}

/** BR-03 in elapsed time: not before the lead time has passed, not after the horizon. */
export function bookableWindow(
  now: Temporal.Instant,
  settings: { readonly minLeadTimeMinutes: number; readonly maxHorizonDays: number },
): { readonly earliest: Temporal.Instant; readonly latest: Temporal.Instant } {
  return {
    earliest: now.add({ minutes: settings.minLeadTimeMinutes }),
    latest: now.add({ hours: settings.maxHorizonDays * 24 }),
  };
}

/**
 * BR-03 for the team (W7): from now on, without the lead time patients keep, because the team books
 * on the phone and at the desk for a time it agrees with the patient; never in the past, and no
 * further ahead than patients can.
 */
export function practiceBookableWindow(
  now: Temporal.Instant,
  settings: { readonly maxHorizonDays: number },
): { readonly earliest: Temporal.Instant; readonly latest: Temporal.Instant } {
  return bookableWindow(now, { minLeadTimeMinutes: 0, maxHorizonDays: settings.maxHorizonDays });
}

/** How many days a range holds, both ends included; zero or less when it runs backwards. */
export function daysInRange(from: Temporal.PlainDate, to: Temporal.PlainDate): number {
  return from.until(to, { largestUnit: 'days' }).days + 1;
}

export interface DayWithFreeTimes {
  readonly date: Temporal.PlainDate;
  readonly hasFreeTimes: boolean;
}

/** One entry per day of the range: whether it has a free time, and never how many. */
export function daysWithFreeTimes(
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
  starts: readonly Temporal.Instant[],
  timeZone: string,
): DayWithFreeTimes[] {
  const free = new Set(
    starts.map((start) => start.toZonedDateTimeISO(timeZone).toPlainDate().toString()),
  );
  return Array.from({ length: daysInRange(from, to) }, (_, offset) => {
    const date = from.add({ days: offset });
    return { date, hasFreeTimes: free.has(date.toString()) };
  });
}

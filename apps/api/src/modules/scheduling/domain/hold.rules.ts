/**
 * BR-27 and M04 part 2: an appointment holds its doctor from its start for the service's duration,
 * and then for the service's buffer. One rule answers both which starts the free times offer and
 * which slots a booking holds, so that a time that is offered is a time that can be booked.
 */

export type SlotStatusName = 'OPEN' | 'BOOKED' | 'BLOCKED';

/** One slot of a doctor, as the rule reads it. */
export interface SlotState {
  readonly id: string;
  readonly providerId: string;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly status: SlotStatusName;
  /** The appointment whose time the slot is part of, from its start to the end of its buffer. */
  readonly heldById: string | null;
  /**
   * The rule the slot is working time of; null when it is none any more (an absence, other hours)
   * and the slot only keeps the history of a cancelled appointment.
   */
  readonly ruleId: string | null;
}

/** How long an appointment of a service holds its doctor. */
export interface HoldLength {
  readonly durationMinutes: number;
  readonly bufferMinutes: number;
}

export interface HoldRange {
  /** The end of the visit: what the patient and the team see as its end. */
  readonly visitEnd: Temporal.Instant;
  /** The end of the buffer: until then no other appointment of the doctor begins (BR-27). */
  readonly holdEnd: Temporal.Instant;
}

const MINUTE_MS = 60_000;

export function holdRangeOf(
  start: Temporal.Instant,
  { durationMinutes, bufferMinutes }: HoldLength,
): HoldRange {
  const visitEnd = start.add({ minutes: durationMinutes });
  return { visitEnd, holdEnd: visitEnd.add({ minutes: bufferMinutes }) };
}

function isBefore(a: Temporal.Instant, b: Temporal.Instant): boolean {
  return Temporal.Instant.compare(a, b) < 0;
}

/**
 * The slots that an appointment beginning with `first`, at `index` of `sorted`, holds, or undefined
 * when that time is not free. The visit runs over the doctor's working slots (with a rule) from its
 * start without a gap; every slot that the visit or the buffer touches is free: OPEN, or held by the
 * appointment this one replaces (`moving`, BR-05). The buffer may run past the doctor's last slot of
 * a day, into a break, or over a slot without a rule, which it holds as well: should that time become
 * working time again, it stays free. `sorted` holds one doctor's slots in the order of their starts.
 */
function holdFrom(
  sorted: readonly SlotState[],
  index: number,
  first: SlotState,
  length: HoldLength,
  moving: string | undefined,
): readonly SlotState[] | undefined {
  const { visitEnd, holdEnd } = holdRangeOf(first.startsAt, length);
  const held: SlotState[] = [];
  let reached = first.startsAt;
  for (const slot of sorted.values().drop(index)) {
    if (!isBefore(slot.startsAt, holdEnd)) break;
    if (slot.status !== 'OPEN' && (moving === undefined || slot.heldById !== moving)) {
      return undefined;
    }
    if (isBefore(reached, visitEnd)) {
      // Inside the visit the next working slot begins where the last one ended.
      if (!slot.startsAt.equals(reached) || slot.ruleId === null) return undefined;
      reached = slot.endsAt;
    }
    held.push(slot);
  }
  return isBefore(reached, visitEnd) ? undefined : held;
}

/**
 * The slots of one doctor that an appointment at `start` holds, or undefined when the time is not
 * free (see `holdFrom`). `slots` are that doctor's slots in the order of their starts.
 */
export function heldSlotsOf(
  slots: readonly SlotState[],
  start: Temporal.Instant,
  length: HoldLength,
  moving?: string,
): readonly SlotState[] | undefined {
  const index = slots.findIndex((slot) => slot.startsAt.equals(start));
  const first = slots[index];
  return first === undefined ? undefined : holdFrom(slots, index, first, length, moving);
}

/**
 * The starts of the free times, each once and in order: a slot that `isStart` accepts (free, the
 * service offered in it, in the bookable window) whose doctor is free from it for the service's
 * duration and buffer, by the rule of `holdFrom`. One pass per doctor from its last slot back, in
 * milliseconds: the public free times read every slot of up to 42 days, and a pass per start would
 * cost the square of that (security review of M04 part 2). Which doctor has a start stays out.
 */
export function freeStartsOf<Slot extends SlotState>(
  slots: readonly Slot[],
  isStart: (slot: Slot) => boolean,
  length: HoldLength,
): Temporal.Instant[] {
  const visitMs = length.durationMinutes * MINUTE_MS;
  const holdMs = visitMs + length.bufferMinutes * MINUTE_MS;
  const starts = new Map<number, Temporal.Instant>();
  for (const own of Map.groupBy(slots, ({ providerId }) => providerId).values()) {
    const sorted = own.toSorted(
      (a, b) => a.startsAt.epochMilliseconds - b.startsAt.epochMilliseconds,
    );
    // Of the slot after this one: where it begins, and how far a visit runs from it over working
    // free slots without a gap. And where the next slot begins that is not free.
    let nextBegin = Infinity;
    let runEnd = -Infinity;
    let taken = Infinity;
    for (const slot of sorted.toReversed()) {
      const begin = slot.startsAt.epochMilliseconds;
      const end = slot.endsAt.epochMilliseconds;
      const free = slot.status === 'OPEN';
      if (!free) taken = begin;
      if (free && slot.ruleId !== null) {
        runEnd = nextBegin === end ? Math.max(end, runEnd) : end;
      } else {
        runEnd = -Infinity;
      }
      nextBegin = begin;
      if (isStart(slot) && runEnd >= begin + visitMs && taken >= begin + holdMs) {
        starts.set(begin, slot.startsAt);
      }
    }
  }
  return [...starts.values()].toSorted((a, b) => a.epochMilliseconds - b.epochMilliseconds);
}

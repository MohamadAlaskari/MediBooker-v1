import { describe, expect, it } from 'vitest';
import {
  freeStartsOf,
  heldSlotsOf,
  type HoldLength,
  holdRangeOf,
  type SlotState,
  type SlotStatusName,
} from './hold.rules.js';

const DOCTOR = 'doctor-a';
const OTHER = 'doctor-b';
const at = (time: string) => Temporal.Instant.from(`2026-11-16T${time}:00Z`);

/** A slot of `minutes` from `time`: free and working time unless said otherwise. */
function slot(
  time: string,
  {
    minutes = 30,
    status = 'OPEN',
    heldById = null,
    providerId = DOCTOR,
    ruleId = 'rule',
  }: {
    readonly minutes?: number;
    readonly status?: SlotStatusName;
    readonly heldById?: string | null;
    readonly providerId?: string;
    readonly ruleId?: string | null;
  } = {},
): SlotState {
  const startsAt = at(time);
  return {
    id: `${providerId}@${time}`,
    providerId,
    startsAt,
    endsAt: startsAt.add({ minutes }),
    status,
    heldById,
    ruleId,
  };
}

const ids = (slots: readonly SlotState[] | undefined) => slots?.map(({ id }) => id);

/** The starts `heldSlotsOf` finds free, one doctor's slots at a time: what `freeStartsOf` must say. */
function freeOneByOne(slots: readonly SlotState[], length: HoldLength): string[] {
  const starts = new Set<string>();
  for (const own of Map.groupBy(slots, ({ providerId }) => providerId).values()) {
    const sorted = own.toSorted((a, b) => Temporal.Instant.compare(a.startsAt, b.startsAt));
    for (const candidate of sorted) {
      const free = candidate.status === 'OPEN' && candidate.ruleId !== null;
      if (free && heldSlotsOf(sorted, candidate.startsAt, length) !== undefined) {
        starts.add(candidate.startsAt.toString());
      }
    }
  }
  return [...starts].toSorted();
}

describe('holdRangeOf (BR-27)', () => {
  it('ends the visit after the duration and the hold after the buffer', () => {
    const { visitEnd, holdEnd } = holdRangeOf(at('09:00'), {
      durationMinutes: 45,
      bufferMinutes: 10,
    });
    expect(visitEnd.toString()).toBe('2026-11-16T09:45:00Z');
    expect(holdEnd.toString()).toBe('2026-11-16T09:55:00Z');
  });
});

describe('heldSlotsOf (BR-27)', () => {
  const week = [slot('09:00'), slot('09:30'), slot('10:00'), slot('10:30')];

  it('holds every slot the visit touches, a whole slot also for part of it', () => {
    const held = heldSlotsOf(week, at('09:00'), { durationMinutes: 45, bufferMinutes: 0 });
    expect(ids(held)).toEqual([`${DOCTOR}@09:00`, `${DOCTOR}@09:30`]);
  });

  it('holds the slots of the buffer too', () => {
    const held = heldSlotsOf(week, at('09:00'), { durationMinutes: 45, bufferMinutes: 20 });
    expect(ids(held)).toEqual([`${DOCTOR}@09:00`, `${DOCTOR}@09:30`, `${DOCTOR}@10:00`]);
  });

  it('lets the buffer run past the last slot of the day, but never the visit', () => {
    expect(ids(heldSlotsOf(week, at('10:00'), { durationMinutes: 60, bufferMinutes: 30 }))).toEqual(
      [`${DOCTOR}@10:00`, `${DOCTOR}@10:30`],
    );
    expect(heldSlotsOf(week, at('10:30'), { durationMinutes: 45, bufferMinutes: 0 })).toBe(
      undefined,
    );
  });

  it('refuses a visit over a gap, and a time that is no start of a slot', () => {
    const withBreak = [slot('09:00'), slot('10:00')];
    expect(heldSlotsOf(withBreak, at('09:00'), { durationMinutes: 45, bufferMinutes: 0 })).toBe(
      undefined,
    );
    // A gap of ten minutes inside the visit, where the next slot still begins before its end.
    const shifted = [slot('09:00'), slot('09:40')];
    expect(heldSlotsOf(shifted, at('09:00'), { durationMinutes: 60, bufferMinutes: 0 })).toBe(
      undefined,
    );
    expect(heldSlotsOf(week, at('09:15'), { durationMinutes: 15, bufferMinutes: 0 })).toBe(
      undefined,
    );
  });

  it('takes a slot without a rule as no working time for the visit, and holds it in the buffer', () => {
    // An absence or other hours left the 09:30 slot without a rule: it keeps a cancelled one's history.
    const history = [slot('09:00'), slot('09:30', { ruleId: null }), slot('10:00')];
    expect(heldSlotsOf(history, at('09:00'), { durationMinutes: 45, bufferMinutes: 0 })).toBe(
      undefined,
    );
    expect(
      ids(heldSlotsOf(history, at('09:00'), { durationMinutes: 30, bufferMinutes: 10 })),
    ).toEqual([`${DOCTOR}@09:00`, `${DOCTOR}@09:30`]);
  });

  it('refuses a time that another appointment or a block touches, also in the buffer', () => {
    const booked = [slot('09:00'), slot('09:30', { status: 'BOOKED', heldById: 'appointment' })];
    expect(heldSlotsOf(booked, at('09:00'), { durationMinutes: 45, bufferMinutes: 0 })).toBe(
      undefined,
    );
    const blocked = [slot('09:00'), slot('09:30', { status: 'BLOCKED' })];
    expect(heldSlotsOf(blocked, at('09:00'), { durationMinutes: 30, bufferMinutes: 10 })).toBe(
      undefined,
    );
  });

  it('takes the time of the appointment a reschedule replaces as free, and only that (BR-05)', () => {
    const own = [
      slot('09:00', { status: 'BOOKED', heldById: 'old' }),
      slot('09:30', { status: 'BOOKED', heldById: 'old' }),
      slot('10:00'),
    ];
    const length = { durationMinutes: 45, bufferMinutes: 0 };
    expect(ids(heldSlotsOf(own, at('09:30'), length, 'old'))).toEqual([
      `${DOCTOR}@09:30`,
      `${DOCTOR}@10:00`,
    ]);
    expect(heldSlotsOf(own, at('09:30'), length, 'another')).toBe(undefined);
    expect(heldSlotsOf(own, at('09:30'), length)).toBe(undefined);
  });
});

describe('freeStartsOf (BR-27)', () => {
  it('offers each start once, in order, where some doctor is free for the whole time', () => {
    const slots = [
      slot('10:00', { providerId: OTHER }),
      slot('09:30'),
      slot('09:00'),
      slot('10:00', { status: 'BOOKED', heldById: 'appointment' }),
      slot('09:00', { providerId: OTHER }),
      slot('09:30', { providerId: OTHER, status: 'BLOCKED' }),
      slot('10:30', { providerId: OTHER }),
    ];
    const starts = freeStartsOf(slots, ({ status }) => status === 'OPEN', {
      durationMinutes: 45,
      bufferMinutes: 0,
    });
    // 09:00 with doctor a; 10:00 with doctor b; 09:30 runs into a's booked 10:00, and
    // b's 09:00 runs into its block.
    expect(starts.map((start) => start.toString())).toEqual([
      '2026-11-16T09:00:00Z',
      '2026-11-16T10:00:00Z',
    ]);
  });

  it('offers only the starts the caller accepts', () => {
    const starts = freeStartsOf(
      [slot('09:00'), slot('09:30')],
      ({ startsAt }) => startsAt.equals(at('09:30')),
      { durationMinutes: 30, bufferMinutes: 0 },
    );
    expect(starts.map((start) => start.toString())).toEqual(['2026-11-16T09:30:00Z']);
  });

  it('says what heldSlotsOf says of every start: gaps, history, blocks, the end of a day', () => {
    const day = [
      slot('08:00'),
      slot('08:30', { ruleId: null }),
      slot('09:00'),
      slot('09:30'),
      slot('10:00', { status: 'BLOCKED' }),
      slot('10:30'),
      slot('11:00', { minutes: 15 }),
      slot('11:30'),
      slot('12:00'),
      slot('12:30', { status: 'BOOKED', heldById: 'appointment' }),
      slot('13:00'),
      slot('08:00', { providerId: OTHER }),
      slot('08:30', { providerId: OTHER }),
      slot('09:30', { providerId: OTHER, ruleId: null }),
    ];
    for (const length of [
      { durationMinutes: 20, bufferMinutes: 0 },
      { durationMinutes: 30, bufferMinutes: 10 },
      { durationMinutes: 45, bufferMinutes: 0 },
      { durationMinutes: 60, bufferMinutes: 30 },
      { durationMinutes: 15, bufferMinutes: 120 },
    ]) {
      const fast = freeStartsOf(
        day,
        ({ status, ruleId }) => status === 'OPEN' && ruleId !== null,
        length,
      );
      expect(fast.map((start) => start.toString())).toEqual(freeOneByOne(day, length));
    }
  });

  it('answers 42 days of ten doctors on a grid of 5 minutes in well under a second', () => {
    const slots: SlotState[] = [];
    const first = Temporal.Instant.from('2026-11-16T05:00:00Z');
    for (let doctor = 0; doctor < 10; doctor += 1) {
      for (let day = 0; day < 42; day += 1) {
        // Ten hours a day; every seventh slot booked.
        for (let step = 0; step < 120; step += 1) {
          const startsAt = first.add({ hours: day * 24, minutes: step * 5 });
          slots.push({
            id: `${String(doctor)}-${String(day)}-${String(step)}`,
            providerId: `doctor-${String(doctor)}`,
            startsAt,
            endsAt: startsAt.add({ minutes: 5 }),
            status: step % 7 === 0 ? 'BOOKED' : 'OPEN',
            heldById: null,
            ruleId: 'rule',
          });
        }
      }
    }
    const started = performance.now();
    const starts = freeStartsOf(slots, ({ status }) => status === 'OPEN', {
      durationMinutes: 240,
      bufferMinutes: 120,
    });
    const took = performance.now() - started;
    expect(starts).toEqual([]);
    expect(took).toBeLessThan(1000);
    const short = freeStartsOf(slots, ({ status }) => status === 'OPEN', {
      durationMinutes: 10,
      bufferMinutes: 5,
    });
    // Per day of a doctor: 120 slots, 18 booked; a start needs itself and the next two free.
    expect(short.length).toBeGreaterThan(0);
  });
});

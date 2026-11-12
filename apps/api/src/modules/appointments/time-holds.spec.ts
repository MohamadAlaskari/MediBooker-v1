import { describe, expect, it, vi } from 'vitest';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { TimeHolds } from './time-holds.js';

const SERVICE = '00000000-0000-4000-8000-0000000000bb';
const DOCTOR_A = '00000000-0000-4000-8000-00000000000a';
const DOCTOR_B = '00000000-0000-4000-8000-00000000000b';
const RULE = '00000000-0000-4000-8000-0000000000aa';
const START = Temporal.Instant.from('2026-11-16T07:00:00Z');
const LENGTH = { durationMinutes: 45, bufferMinutes: 0 };

/** A slot row of a doctor, from `minute` past 07:00 for 30 minutes. */
function row(
  providerId: string,
  minute: number,
  {
    status = 'OPEN',
    heldById = null,
    ruleId = RULE,
  }: {
    readonly status?: string;
    readonly heldById?: string | null;
    readonly ruleId?: string | null;
  } = {},
) {
  const startsAt = START.add({ minutes: minute });
  return {
    id: `${providerId}+${String(minute)}`,
    provider_id: providerId,
    starts_at: new Date(startsAt.epochMilliseconds),
    ends_at: new Date(startsAt.add({ minutes: 30 }).epochMilliseconds),
    status,
    held_by_id: heldById,
    rule_id: ruleId,
  };
}

const candidate = (providerId: string, minute = 0) => ({
  id: `${providerId}+${String(minute)}`,
  provider_id: providerId,
  rule_id: RULE,
});

function setUp(...answers: unknown[][]) {
  const $queryRaw = vi.fn();
  for (const answer of answers) $queryRaw.mockResolvedValueOnce(answer);
  const db = { $queryRaw, slot: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) } };
  const holds = new TimeHolds({ tx: db } as unknown as PracticeTransactionHost);
  return { holds, db };
}

describe('TimeHolds.take (BR-27)', () => {
  it('takes the first doctor whose whole time is free, and holds every slot of it', async () => {
    const { holds, db } = setUp(
      [candidate(DOCTOR_A), candidate(DOCTOR_B)],
      // Doctor a: the second half of the visit is booked.
      [row(DOCTOR_A, 0), row(DOCTOR_A, 30, { status: 'BOOKED', heldById: 'other' })],
      [row(DOCTOR_B, 0), row(DOCTOR_B, 30)],
      [row(DOCTOR_B, 0), row(DOCTOR_B, 30)],
    );
    const taken = await holds.take({
      serviceId: SERVICE,
      startsAt: START,
      providerId: undefined,
      length: LENGTH,
    });
    expect(taken).toEqual({
      slotId: `${DOCTOR_B}+0`,
      providerId: DOCTOR_B,
      heldIds: [`${DOCTOR_B}+0`, `${DOCTOR_B}+30`],
      visitEnd: START.add({ minutes: 45 }),
    });
    expect(db.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it('counts a slot that another transaction holds right now, or that changed, as taken', async () => {
    const free = [row(DOCTOR_A, 0), row(DOCTOR_A, 30)];
    const wanted = { serviceId: SERVICE, startsAt: START, providerId: DOCTOR_A, length: LENGTH };
    // SKIP LOCKED left one out.
    const skipped = setUp([candidate(DOCTOR_A)], free, [row(DOCTOR_A, 0)]);
    await expect(skipped.holds.take(wanted)).resolves.toBe(undefined);
    // Blocked since the read.
    const blocked = setUp([candidate(DOCTOR_A)], free, [
      row(DOCTOR_A, 0),
      row(DOCTOR_A, 30, { status: 'BLOCKED' }),
    ]);
    await expect(blocked.holds.take(wanted)).resolves.toBe(undefined);
    // The start left the rule that offers the service since the read (BR-08).
    const unlinked = setUp([candidate(DOCTOR_A)], free, [
      row(DOCTOR_A, 0, { ruleId: 'another-rule' }),
      row(DOCTOR_A, 30),
    ]);
    await expect(unlinked.holds.take(wanted)).resolves.toBe(undefined);
  });

  it('takes the time of the appointment a reschedule replaces as free (BR-05)', async () => {
    const own = [row(DOCTOR_A, 30, { status: 'BOOKED', heldById: 'old' }), row(DOCTOR_A, 60)];
    const { holds } = setUp([candidate(DOCTOR_A, 30)], own, own);
    const taken = await holds.take({
      serviceId: SERVICE,
      startsAt: START.add({ minutes: 30 }),
      providerId: DOCTOR_A,
      length: LENGTH,
      moving: { id: 'old', slotId: `${DOCTOR_A}+0` },
    });
    expect(taken?.heldIds).toEqual([`${DOCTOR_A}+30`, `${DOCTOR_A}+60`]);
  });

  it('answers undefined when no doctor offers the service then', async () => {
    const { holds } = setUp([]);
    await expect(
      holds.take({ serviceId: SERVICE, startsAt: START, providerId: undefined, length: LENGTH }),
    ).resolves.toBe(undefined);
  });
});

describe('TimeHolds.hold and lockHeld', () => {
  it('books the free slots for the appointment, and fails when one is no longer free', async () => {
    const { holds, db } = setUp();
    await holds.hold(['a', 'b'], 'appointment');
    expect(db.slot.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, status: 'OPEN' },
      data: { status: 'BOOKED', heldById: 'appointment' },
    });
    db.slot.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(holds.hold(['a', 'b'], 'appointment')).rejects.toThrow('not free');
  });

  it('locks the slots an appointment holds, in the order of their starts', async () => {
    const { holds, db } = setUp([]);
    await holds.lockHeld('appointment');
    const [sql] = db.$queryRaw.mock.calls[0] as [readonly string[]];
    expect(sql.join('?')).toMatch(/ORDER BY starts_at FOR UPDATE/u);
  });
});

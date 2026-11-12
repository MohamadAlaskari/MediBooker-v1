import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { dbInstantOf, instantOf } from '../../common/time/convert.js';
import {
  heldSlotsOf,
  type HoldLength,
  holdRangeOf,
  type SlotState,
  type SlotStatusName,
} from '../scheduling/domain/hold.rules.js';

/** A time to hold for an appointment. */
export interface WantedTime {
  readonly serviceId: string;
  readonly startsAt: Temporal.Instant;
  readonly providerId: string | undefined;
  readonly length: HoldLength;
  /** The appointment a reschedule replaces (BR-05): its time counts as free, its start does not. */
  readonly moving?: { readonly id: string; readonly slotId: string } | undefined;
}

/** The doctor's time a booking takes: its first slot and every slot of its visit and buffer. */
export interface TakenTime {
  readonly slotId: string;
  readonly providerId: string;
  readonly heldIds: readonly string[];
  readonly visitEnd: Temporal.Instant;
}

interface SlotRow {
  readonly id: string;
  readonly provider_id: string;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly status: SlotStatusName;
  readonly held_by_id: string | null;
  readonly rule_id: string | null;
}

function stateOf(row: SlotRow): SlotState {
  return {
    id: row.id,
    providerId: row.provider_id,
    startsAt: instantOf(row.starts_at),
    endsAt: instantOf(row.ends_at),
    status: row.status,
    heldById: row.held_by_id,
    ruleId: row.rule_id,
  };
}

/**
 * The slots an appointment holds, from its start to the end of its buffer (BR-27): every one is
 * BOOKED and names the appointment, so that the free times, a block (BR-07) and every booking see the
 * doctor taken. A booking reads the doctor's slots of the time first and then locks exactly those
 * SKIP LOCKED: it never waits for another transaction on a slot, so no two bookings can wait for
 * each other, whatever the lengths and the order of their slots. A slot that another transaction
 * holds right now makes that doctor's time count as taken, as a booked one would.
 *
 * A cancel frees the whole time in the database (the trigger `appointments_release_on_cancel`), so
 * that it does whichever release of the code cancels. What waits for slot locks takes them in the
 * order of their starts: `lockHeld` before a cancel or a reschedule, and a doctor's new week
 * (security review of M04 part 2).
 */
@Injectable()
export class TimeHolds {
  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
  ) {}

  /**
   * The first doctor, in the order of their ids, who offers the service at that start and is free
   * for its whole time; undefined when there is none. The slots stay locked until the transaction
   * ends; `hold` marks them once the appointment exists.
   */
  async take({
    serviceId,
    startsAt,
    providerId,
    length,
    moving,
  }: WantedTime): Promise<TakenTime | undefined> {
    const db = this.txHost.tx;
    const { visitEnd, holdEnd } = holdRangeOf(startsAt, length);
    const movingId = moving?.id ?? undefined;
    // Same time, same doctor as the appointment it replaces is no other time.
    const candidates = await db.$queryRaw<{ id: string; provider_id: string; rule_id: string }[]>`
      SELECT s.id, s.provider_id, s.rule_id
      FROM slots s
      JOIN availability_rule_services rs ON rs.rule_id = s.rule_id
      JOIN staff_members p ON p.id = s.provider_id
      WHERE rs.service_id = ${serviceId}::uuid
        AND s.starts_at = ${dbInstantOf(startsAt)}
        AND (s.status = 'OPEN' OR s.held_by_id = ${movingId ?? null}::uuid)
        AND s.id IS DISTINCT FROM ${moving?.slotId ?? null}::uuid
        AND p.is_provider
        AND (${providerId ?? null}::uuid IS NULL OR s.provider_id = ${providerId ?? null}::uuid)
      ORDER BY s.provider_id`;
    for (const candidate of candidates) {
      const rows = await db.$queryRaw<SlotRow[]>`
        SELECT id, provider_id, starts_at, ends_at, status::text AS status, held_by_id, rule_id
        FROM slots
        WHERE provider_id = ${candidate.provider_id}::uuid
          AND starts_at < ${dbInstantOf(holdEnd)}
          AND ends_at > ${dbInstantOf(startsAt)}
        ORDER BY starts_at`;
      const planned = heldSlotsOf(rows.map(stateOf), startsAt, length, movingId);
      if (planned === undefined) continue;
      const heldIds = planned.map(({ id }) => id);
      const locked = await db.$queryRaw<SlotRow[]>`
        SELECT id, provider_id, starts_at, ends_at, status::text AS status, held_by_id, rule_id
        FROM slots
        WHERE id = ANY(${heldIds}::uuid[])
        ORDER BY starts_at
        FOR UPDATE SKIP LOCKED`;
      // The same rule on the slots as they are under the lock: one that another transaction holds
      // right now (SKIP LOCKED left it out) or that changed since the read makes the time taken,
      // and the start keeps the rule that offers the service (BR-08).
      const still =
        locked.length === heldIds.length
          ? heldSlotsOf(locked.map(stateOf), startsAt, length, movingId)
          : undefined;
      if (still?.length === heldIds.length && locked[0]?.rule_id === candidate.rule_id) {
        return { slotId: candidate.id, providerId: candidate.provider_id, heldIds, visitEnd };
      }
    }
    return undefined;
  }

  /**
   * The appointment's slots: booked, and naming it. They are locked since `take`, and free: those of
   * the appointment a reschedule replaces since its cancel. Anything else is a fault, and the
   * transaction ends here.
   */
  async hold(heldIds: readonly string[], appointmentId: string): Promise<void> {
    const { count } = await this.txHost.tx.slot.updateMany({
      where: { id: { in: [...heldIds] }, status: 'OPEN' },
      data: { status: 'BOOKED', heldById: appointmentId },
    });
    if (count !== heldIds.length) throw new Error('A slot to hold is not free');
  }

  /** The slots an appointment holds, locked in the order of their starts before they are freed. */
  async lockHeld(appointmentId: string): Promise<void> {
    await this.txHost.tx.$queryRaw`
      SELECT id FROM slots WHERE held_by_id = ${appointmentId}::uuid ORDER BY starts_at FOR UPDATE`;
  }
}

/**
 * A slot that holds the history of a cancelled appointment, when the rules no longer want its time.
 * The history needs the slot, so generation cannot remove it: it must neither stop the night's run
 * nor stay bookable. Against real databases, with slots from the seed's rules.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SlotGenerationJob } from '../../../src/modules/scheduling/slot-generation.job.js';
import { API, type Fixture, NOW, useBookingWorld } from './booking-world.js';

interface SlotRow {
  readonly id: string;
  readonly status: string;
  readonly rule_id: string | null;
}

describe('slots that hold a cancelled appointment', () => {
  const world = useBookingWorld();

  const slotAtTime = (practice: Fixture, startsAt: string): Promise<SlotRow | undefined> =>
    world.asOwner(practice, async (owner) => {
      const { rows } = await owner.query<SlotRow>(
        'SELECT id, status, rule_id FROM slots WHERE provider_id = $1 AND starts_at = $2',
        [practice.providerId, startsAt],
      );
      return rows[0];
    });

  const offeredByTheDoctor = async (practice: Fixture, startsAt: string): Promise<boolean> => {
    const instant = Temporal.Instant.from(startsAt);
    const response = await request(world.server())
      .get(`${API}/public/practices/al-noor/slots`)
      .query({
        serviceId: practice.serviceId,
        providerId: practice.providerId,
        date: instant.toZonedDateTimeISO('Asia/Riyadh').toPlainDate().toString(),
      })
      .set('X-Forwarded-For', '203.0.113.20')
      .expect(200);
    const { times } = response.body as { times: { startsAt: string }[] };
    return times.some((time) => time.startsAt === instant.toString());
  };

  it('does not stop the run, withdraws the time, and offers it again when it is wanted again', async () => {
    const practice = world.alNoor();
    const job = world.app().get(SlotGenerationJob);
    await expect(job.run()).resolves.toMatchObject({ failed: 0 });

    // A slot of the seed's public doctor for this service, far enough ahead to be cancelled.
    const startsAt = await world.asOwner(practice, async (owner) => {
      const { rows } = await owner.query<{ starts_at: Date }>(
        `SELECT s.starts_at FROM slots s JOIN availability_rule_services rs ON rs.rule_id = s.rule_id
         WHERE s.provider_id = $1 AND rs.service_id = $2 AND s.status = 'OPEN' AND s.starts_at > $3
         ORDER BY s.starts_at LIMIT 1`,
        [
          practice.providerId,
          practice.serviceId,
          new Date(NOW.add({ hours: 72 }).epochMilliseconds),
        ],
      );
      return Temporal.Instant.fromEpochMilliseconds(rows[0]?.starts_at.getTime() ?? 0).toString();
    });
    const who = await world.patient(practice);
    const booked = await world
      .book(who, practice, {
        serviceId: practice.serviceId,
        startsAt,
        providerId: practice.providerId,
      })
      .expect(201);
    await world.cancel(who, practice, (booked.body as { id: string }).id).expect(200);
    const before = await slotAtTime(practice, startsAt);
    expect(before).toMatchObject({ status: 'OPEN' });
    const ruleId = before?.rule_id;
    expect(ruleId).toEqual(expect.any(String));

    // The doctor is away on that day: the rules no longer want the time.
    const instant = Temporal.Instant.from(startsAt);
    await world.asOwner(practice, (owner) =>
      owner.query(
        `INSERT INTO availability_exceptions (provider_id, starts_at, ends_at, reason)
         VALUES ($1, $2, $3, 'VACATION')`,
        [
          practice.providerId,
          instant.subtract({ hours: 1 }).toString(),
          instant.add({ hours: 1 }).toString(),
        ],
      ),
    );
    await expect(job.run()).resolves.toMatchObject({ failed: 0 });

    await expect(slotAtTime(practice, startsAt)).resolves.toMatchObject({
      id: before?.id,
      status: 'OPEN',
      rule_id: null,
    });
    await expect(offeredByTheDoctor(practice, startsAt)).resolves.toBe(false);
    const refused = await world
      .book(who, practice, {
        serviceId: practice.serviceId,
        startsAt,
        providerId: practice.providerId,
      })
      .expect(409);
    expect(refused.body).toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });

    // The other slots of that absence are gone, as for any change of a rule.
    const left = await world.asOwner(practice, async (owner) => {
      const { rows } = await owner.query<{ count: string }>(
        `SELECT count(*) FROM slots WHERE provider_id = $1 AND starts_at > $2 AND starts_at < $3`,
        [
          practice.providerId,
          instant.subtract({ hours: 1 }).toString(),
          instant.add({ hours: 1 }).toString(),
        ],
      );
      return Number(rows[0]?.count);
    });
    expect(left).toBe(1);

    // The doctor is back: the time is offered and can be booked again, on the same row.
    await world.asOwner(practice, (owner) =>
      owner.query('DELETE FROM availability_exceptions WHERE provider_id = $1', [
        practice.providerId,
      ]),
    );
    await expect(job.run()).resolves.toMatchObject({ failed: 0 });
    await expect(slotAtTime(practice, startsAt)).resolves.toMatchObject({
      id: before?.id,
      status: 'OPEN',
      rule_id: ruleId,
    });
    await expect(offeredByTheDoctor(practice, startsAt)).resolves.toBe(true);
    const again = await world
      .book(who, practice, {
        serviceId: practice.serviceId,
        startsAt,
        providerId: practice.providerId,
      })
      .expect(201);
    expect((again.body as { id: string }).id).not.toBe((booked.body as { id: string }).id);
  });
});

/**
 * Booking by duration and buffer on real databases (08 M04 part 2, BR-27): an appointment holds its
 * doctor from its start for the service's duration and then for its buffer, with whole slots; the
 * free times offer only starts whose whole time is free, a cancel frees all of it, and a reschedule
 * may move an appointment by less than its length.
 */
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, stepOf } from '../../../src/modules/auth/domain/totp.js';
import { StaffRoles } from '../../../src/modules/staff/staff-roles.js';
import { API, type Fixture, type Person, useBookingWorld } from './booking-world.js';

const RIYADH = 'Asia/Riyadh';

interface Booked {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

interface SlotView {
  readonly starts_at: Date;
  readonly status: string;
  readonly held_by_id: string | null;
}

describe('booking by duration and buffer on real databases (BR-27)', () => {
  // The installation's practice, so that the team's roles name it (ADR 0016).
  const world = useBookingWorld({ PRACTICE_SLUG: 'al-noor' });
  let staff: Person;

  /** The time of the online service, for the test that sets it. */
  const lengthOf = (durationMinutes: number, bufferMinutes: number) =>
    world.asOwner(world.alNoor(), (owner) =>
      owner.query('UPDATE services SET duration_minutes = $2, buffer_minutes = $3 WHERE id = $1', [
        world.alNoor().serviceId,
        durationMinutes,
        bufferMinutes,
      ]),
    );

  /** `count` slots of the doctor one after the other, `hours` ahead of a fresh time. */
  const run = async (count: number, hours = 0): Promise<Temporal.Instant[]> => {
    const first = world.freshTime().add({ hours });
    // Fresh times are 31 minutes apart: keep the next ones clear of these slots.
    for (let taken = 1; taken < count; taken += 1) world.freshTime();
    const starts = Array.from({ length: count }, (_, index) => first.add({ minutes: 30 * index }));
    for (const startsAt of starts) await world.slotAt(world.alNoor(), startsAt);
    return starts;
  };

  const slotsOf = (starts: readonly Temporal.Instant[]): Promise<SlotView[]> =>
    world.asOwner(world.alNoor(), async (owner) => {
      const { rows } = await owner.query<SlotView>(
        `SELECT starts_at, status::text AS status, held_by_id FROM slots
         WHERE provider_id = $1 AND starts_at = ANY($2::timestamptz[]) ORDER BY starts_at`,
        [world.alNoor().providerId, starts.map((start) => start.toString())],
      );
      return rows;
    });

  /** The doctor's free starts of the day of `start` among `starts`. */
  const offered = async (starts: readonly Temporal.Instant[]): Promise<string[]> => {
    const fixture: Fixture = world.alNoor();
    const first = starts[0] ?? Temporal.Now.instant();
    const answer = await request(world.server())
      .get(`${API}/public/practices/al-noor/slots`)
      .query({
        serviceId: fixture.serviceId,
        providerId: fixture.providerId,
        date: first.toZonedDateTimeISO(RIYADH).toPlainDate().toString(),
      })
      .expect(200);
    const wanted = new Set(starts.map((start) => start.toString()));
    return (answer.body as { times: { startsAt: string }[] }).times
      .map(({ startsAt }) => Temporal.Instant.from(startsAt).toString())
      .filter((start) => wanted.has(start));
  };

  const bookAt = async (startsAt: Temporal.Instant, status = 201): Promise<Booked> => {
    const who = await world.patient(world.alNoor());
    const answer = await world
      .book(who, world.alNoor(), {
        serviceId: world.alNoor().serviceId,
        startsAt: startsAt.toString(),
        providerId: world.alNoor().providerId,
      })
      .expect(status);
    return answer.body as Booked;
  };

  beforeAll(async () => {
    const who = await world.person();
    await world.app().get(StaffRoles).setRole(who.email, 'STAFF', 'local:test');
    const start = await world
      .send(request(world.server()).post(`${API}/me/mfa/totp`), who)
      .expect(200);
    const { secret } = start.body as { secret: string };
    const confirmed = await world
      .send(request(world.server()).post(`${API}/me/mfa/totp/confirm`), who)
      .send({ code: hotp(base32Decode(secret), stepOf(world.clock.now())) })
      .expect(200);
    staff = {
      ...who,
      token: (confirmed.body as { tokens: { accessToken: string } }).tokens.accessToken,
    };
  });

  afterEach(async () => {
    await lengthOf(20, 0);
  });

  it('holds the doctor for the visit, its last slot whole, and offers no start inside it', async () => {
    await lengthOf(45, 0);
    const starts = await run(3);
    const [t0, t1, t2] = starts as [Temporal.Instant, Temporal.Instant, Temporal.Instant];
    // 08:00 holds two slots; the last one is too short for a visit of 45 minutes.
    expect(await offered(starts)).toEqual([t0.toString(), t1.toString()]);
    const booked = await bookAt(t0);
    expect(booked.endsAt).toBe(t0.add({ minutes: 45 }).toString());
    expect(await slotsOf(starts)).toMatchObject([
      { status: 'BOOKED', held_by_id: booked.id },
      { status: 'BOOKED', held_by_id: booked.id },
      { status: 'OPEN', held_by_id: null },
    ]);
    expect(await offered(starts)).toEqual([]);
    const refused = await bookAt(t1, 409);
    expect(refused).toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
    expect(t2).toBeDefined();
  });

  it('keeps the buffer free after the visit, and lets it run past the last slot', async () => {
    await lengthOf(30, 10);
    const starts = await run(3);
    const [t0, t1, t2] = starts as [Temporal.Instant, Temporal.Instant, Temporal.Instant];
    const first = await bookAt(t0);
    expect(first.endsAt).toBe(t1.toString());
    // The buffer's ten minutes reach into the next slot, which is held whole.
    expect((await slotsOf(starts)).map(({ status }) => status)).toEqual([
      'BOOKED',
      'BOOKED',
      'OPEN',
    ]);
    expect(await offered(starts)).toEqual([t2.toString()]);
    const last = await bookAt(t2);
    expect((await slotsOf([t2]))[0]?.held_by_id).toBe(last.id);
  });

  it('frees the whole time on a cancel by the patient, and offers it again', async () => {
    await lengthOf(45, 0);
    const starts = await run(2, 48);
    const [t0] = starts as [Temporal.Instant, Temporal.Instant];
    const who = await world.patient(world.alNoor());
    const answer = await world
      .book(who, world.alNoor(), {
        serviceId: world.alNoor().serviceId,
        startsAt: t0.toString(),
        providerId: world.alNoor().providerId,
      })
      .expect(201);
    const { id } = answer.body as Booked;
    await world.cancel(who, world.alNoor(), id).expect(200);
    expect(await slotsOf(starts)).toMatchObject([
      { status: 'OPEN', held_by_id: null },
      { status: 'OPEN', held_by_id: null },
    ]);
    expect(await offered(starts)).toEqual([t0.toString()]);
  });

  it('moves an appointment by less than its length, and frees what the new time leaves (BR-05)', async () => {
    await lengthOf(45, 0);
    const starts = await run(3, 48);
    const [t0, t1] = starts as [Temporal.Instant, Temporal.Instant, Temporal.Instant];
    const who = await world.patient(world.alNoor());
    const answer = await world
      .book(who, world.alNoor(), {
        serviceId: world.alNoor().serviceId,
        startsAt: t0.toString(),
        providerId: world.alNoor().providerId,
      })
      .expect(201);
    const old = answer.body as Booked;
    // The same time is no other time.
    await world
      .reschedule(who, world.alNoor(), old.id, {
        startsAt: t0.toString(),
        providerId: world.alNoor().providerId,
      })
      .expect(409);
    const moved = await world
      .reschedule(who, world.alNoor(), old.id, {
        startsAt: t1.toString(),
        providerId: world.alNoor().providerId,
      })
      .expect(201);
    const fresh = moved.body as Booked;
    expect(fresh.startsAt).toBe(t1.toString());
    expect(await slotsOf(starts)).toMatchObject([
      { status: 'OPEN', held_by_id: null },
      { status: 'BOOKED', held_by_id: fresh.id },
      { status: 'BOOKED', held_by_id: fresh.id },
    ]);
  });

  it('lets one of two bookings whose times overlap have them, also at the same moment', async () => {
    await lengthOf(45, 0);
    const starts = await run(3);
    const [t0, t1] = starts as [Temporal.Instant, Temporal.Instant, Temporal.Instant];
    const [one, two] = await Promise.all([
      world.patient(world.alNoor()),
      world.patient(world.alNoor()),
    ]);
    const answers = await Promise.all(
      [
        [one, t0],
        [two, t1],
      ].map(([who, startsAt]) =>
        world.book(who as Person, world.alNoor(), {
          serviceId: world.alNoor().serviceId,
          startsAt: (startsAt as Temporal.Instant).toString(),
          providerId: world.alNoor().providerId,
        }),
      ),
    );
    expect(answers.map(({ status }) => status).toSorted()).toEqual([201, 409]);
    // The slot both wanted is held once, by the one that got it.
    const winner = answers.find(({ status }) => status === 201)?.body as Booked;
    expect((await slotsOf([t1]))[0]?.held_by_id).toBe(winner.id);
  });

  it('shows the team the rest of an appointment in the week, and frees it all on its cancel', async () => {
    await lengthOf(45, 0);
    const starts = await run(2);
    const [t0, t1] = starts as [Temporal.Instant, Temporal.Instant];
    const booked = await bookAt(t0);
    const practiceId = world.alNoor().practice.practiceId;
    const week = await world
      .send(request(world.server()).get(`${API}/practices/${practiceId}/desk/week`), staff)
      .query({
        providerId: world.alNoor().providerId,
        from: t0.toZonedDateTimeISO(RIYADH).toPlainDate().toString(),
      })
      .expect(200);
    const shown = (
      week.body as {
        slots: { startsAt: string; continuation: boolean; appointment: { id: string } | null }[];
      }
    ).slots.filter(({ startsAt }) => starts.some((start) => start.toString() === startsAt));
    expect(shown).toMatchObject([
      { startsAt: t0.toString(), continuation: false, appointment: { id: booked.id } },
      { startsAt: t1.toString(), continuation: true, appointment: { id: booked.id } },
    ]);
    await world
      .send(
        request(world.server()).post(
          `${API}/practices/${practiceId}/desk/appointments/${booked.id}/cancel`,
        ),
        staff,
      )
      .send({ cancelReason: 'Synthetic: the doctor is ill' })
      .expect(200);
    expect((await slotsOf(starts)).map(({ status }) => status)).toEqual(['OPEN', 'OPEN']);
  });

  it('offers and books no visit over a slot without a rule, such as one an absence left', async () => {
    await lengthOf(45, 0);
    const starts = await run(2);
    const [t0, t1] = starts as [Temporal.Instant, Temporal.Instant];
    // The second slot only keeps a cancelled appointment's history: no working time any more.
    await world.asOwner(world.alNoor(), (owner) =>
      owner.query('UPDATE slots SET rule_id = NULL WHERE provider_id = $1 AND starts_at = $2', [
        world.alNoor().providerId,
        t1.toString(),
      ]),
    );
    expect(await offered(starts)).toEqual([]);
    const refused = await bookAt(t0, 409);
    expect(refused).toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
  });

  it('keeps the release before this one working on this schema: its booking and its cancel', async () => {
    await lengthOf(45, 0);
    const starts = await run(2);
    const [t0, t1] = starts as [Temporal.Instant, Temporal.Instant];
    // A booking of this release, cancelled the way the release before cancels: the appointment,
    // then its first slot only.
    const booked = await bookAt(t0);
    await world.asOwner(world.alNoor(), async (owner) => {
      await owner.query(
        `UPDATE appointments SET status = 'CANCELLED', cancelled_at = now(),
           cancelled_by_id = booked_by_id WHERE id = $1`,
        [booked.id],
      );
      await owner.query(
        `UPDATE slots SET status = 'OPEN'
         WHERE id = (SELECT slot_id FROM appointments WHERE id = $1) AND status = 'BOOKED'`,
        [booked.id],
      );
    });
    expect(await slotsOf(starts)).toMatchObject([
      { status: 'OPEN', held_by_id: null },
      { status: 'OPEN', held_by_id: null },
    ]);
    // A booking of the release before: no end of the visit, and its slot booked without a name.
    const patientId = await world.join(await world.person(), world.alNoor());
    const old = await world.asOwner(world.alNoor(), async (owner) => {
      const { rows } = await owner.query<{ id: string; ends_at: Date }>(
        `INSERT INTO appointments (patient_id, slot_id, service_id, booked_by_id, booked_at, status)
         SELECT $1, s.id, $2, $3, now(), 'BOOKED' FROM slots s
         WHERE s.provider_id = $4 AND s.starts_at = $5
         RETURNING id, ends_at`,
        [patientId, world.alNoor().serviceId, patientId, world.alNoor().providerId, t1.toString()],
      );
      await owner.query(
        `UPDATE slots SET status = 'BOOKED' WHERE provider_id = $1 AND starts_at = $2`,
        [world.alNoor().providerId, t1.toString()],
      );
      return rows[0];
    });
    expect(old?.ends_at.toISOString()).toBe(
      new Date(t1.add({ minutes: 30 }).epochMilliseconds).toISOString(),
    );
    // This release cancels it, and frees the slot that names nobody.
    await world.asOwner(world.alNoor(), (owner) =>
      owner.query(
        `UPDATE appointments SET status = 'CANCELLED', cancelled_at = now(),
           cancelled_by_id = booked_by_id WHERE id = $1`,
        [old?.id],
      ),
    );
    expect((await slotsOf([t1]))[0]).toMatchObject({ status: 'OPEN', held_by_id: null });
  });
});

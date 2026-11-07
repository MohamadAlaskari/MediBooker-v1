/**
 * Booking at the same time, on real PostgreSQL only (06 §5). Every assertion checks the code, not
 * only the status. The app's pool holds more connections than the requests here, so that a shortage
 * would fail with its own error instead of a flaky 500.
 */
import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Fixture, type Person, useBookingWorld } from './booking-world.js';

const PARALLEL = 10;
const ROUNDS = 20;

interface Answer {
  readonly status: number;
  readonly code?: string;
  readonly id?: string;
}

function answerOf({ status, body }: Response): Answer {
  const { code, id } = body as { code?: string; id?: string };
  return { status, ...(code === undefined ? {} : { code }), ...(id === undefined ? {} : { id }) };
}

describe('booking at the same time on real PostgreSQL (06 §5)', () => {
  const world = useBookingWorld({
    PRACTICE_POOL_MAX: String(PARALLEL + 2),
    DATABASE_TX_MAX_WAIT_MS: '10000',
    DATABASE_TX_TIMEOUT_MS: '20000',
  });
  let alNoorPatients: Person[];
  let lindenhofPatients: Person[];

  const patientsOf = async (fixture: Fixture): Promise<Person[]> => {
    const people: Person[] = [];
    for (let index = 0; index < PARALLEL; index += 1) people.push(await world.patient(fixture));
    return people;
  };

  const burst = async (
    fixture: Fixture,
    people: readonly Person[],
    startsAt: Temporal.Instant,
  ): Promise<readonly Answer[]> => {
    const responses = await Promise.all(
      people.map((who) =>
        world.book(who, fixture, {
          serviceId: fixture.serviceId,
          startsAt: startsAt.toString(),
        }),
      ),
    );
    return responses.map((response) => answerOf(response));
  };

  /** Asserts, and says how many it found, so that a test names what it expects. */
  const expectOneBooking = async (
    fixture: Fixture,
    startsAt: Temporal.Instant,
    answers: readonly Answer[],
  ): Promise<number> => {
    const booked = answers.filter(({ status }) => status === 201);
    const refused = answers.filter(({ status }) => status !== 201);
    expect(booked).toHaveLength(1);
    expect(refused).toEqual(
      Array.from({ length: answers.length - 1 }, () => ({
        status: 409,
        code: 'SLOT_NOT_AVAILABLE',
      })),
    );
    await expect(world.activeAt(fixture, startsAt)).resolves.toEqual([
      { id: booked[0]?.id, slot_status: 'BOOKED' },
    ]);
    await freePlaces(fixture);
    return booked.length;
  };

  /** Here only BR-01 is at work: these people book many times, and BR-02 has its own test. */
  const freePlaces = async (fixture: Fixture): Promise<void> => {
    await world.asOwner(fixture, (owner) =>
      owner.query("UPDATE appointments SET status = 'CANCELLED' WHERE status = 'BOOKED'"),
    );
  };

  beforeAll(async () => {
    alNoorPatients = await patientsOf(world.alNoor());
    lindenhofPatients = await patientsOf(world.lindenhof());
  });

  it(`BR-01 ${String(PARALLEL)} patients book one slot in parallel, ${String(ROUNDS)} times: exactly one gets it`, async () => {
    const practice = world.alNoor();
    for (let round = 0; round < ROUNDS; round += 1) {
      const startsAt = await world.freshSlot(practice);
      const booked = await expectOneBooking(
        practice,
        startsAt,
        await burst(practice, alNoorPatients, startsAt),
      );
      expect(booked).toBe(1);
    }
  });

  it('BR-01 the same burst in two practices at once: each ends with one booking per slot', async () => {
    const [alNoor, lindenhof] = [world.alNoor(), world.lindenhof()];
    for (let round = 0; round < 5; round += 1) {
      const [inAlNoor, inLindenhof] = [
        await world.freshSlot(alNoor),
        await world.freshSlot(lindenhof),
      ];
      const [alNoorAnswers, lindenhofAnswers] = await Promise.all([
        burst(alNoor, alNoorPatients, inAlNoor),
        burst(lindenhof, lindenhofPatients, inLindenhof),
      ]);
      expect(await expectOneBooking(alNoor, inAlNoor, alNoorAnswers)).toBe(1);
      expect(await expectOneBooking(lindenhof, inLindenhof, lindenhofAnswers)).toBe(1);
    }
  });

  it('BR-01 with two doctors free, two of ten get a slot and the others are told', async () => {
    const practice = world.alNoor();
    const startsAt = world.freshTime();
    await world.slotAt(practice, startsAt);
    await world.slotAt(practice, startsAt, { other: true });
    const answers = await burst(practice, alNoorPatients, startsAt);
    expect(answers.filter(({ status }) => status === 201)).toHaveLength(2);
    expect(answers.filter(({ code }) => code === 'SLOT_NOT_AVAILABLE')).toHaveLength(PARALLEL - 2);
    await expect(world.activeAt(practice, startsAt)).resolves.toHaveLength(2);
    await freePlaces(practice);
  });

  it('BR-01 the same Idempotency-Key twice in parallel: one appointment, the same answer', async () => {
    const practice = world.alNoor();
    const [who] = alNoorPatients;
    const startsAt = await world.freshSlot(practice);
    const key = randomUUID();
    const body = { serviceId: practice.serviceId, startsAt: startsAt.toString() };
    const answers = await Promise.all([
      world.book(who, practice, body, key),
      world.book(who, practice, body, key),
    ]);
    const [first, second] = answers.map((response) => answerOf(response));
    expect(first?.status).toBe(201);
    expect(second?.status).toBe(201);
    expect(second?.id).toBe(first?.id);
    await expect(world.activeAt(practice, startsAt)).resolves.toHaveLength(1);
    await freePlaces(practice);
  });

  it('BR-02 a patient with a limit of 2 sends 3 parallel bookings: exactly 2 get through', async () => {
    const practice = world.lindenhof();
    const who = await world.patient(practice);
    const times = [
      await world.freshSlot(practice),
      await world.freshSlot(practice),
      await world.freshSlot(practice),
    ];
    const responses = await Promise.all(
      times.map((startsAt) =>
        world.book(who, practice, { serviceId: practice.serviceId, startsAt: startsAt.toString() }),
      ),
    );
    const answers = responses.map((response) => answerOf(response));
    expect(answers.filter(({ status }) => status === 201)).toHaveLength(2);
    expect(answers.filter(({ status }) => status !== 201)).toEqual([
      { status: 409, code: 'BOOKING_LIMIT_REACHED' },
    ]);
  });
});

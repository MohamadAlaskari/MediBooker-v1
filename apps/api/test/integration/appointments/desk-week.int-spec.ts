/**
 * The calendar on real databases (08 M05, W2): one doctor's week with every slot and the appointment
 * that holds it, the absences in which no slot exists, and the audit of the appointments shown.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, stepOf } from '../../../src/modules/auth/domain/totp.js';
import { StaffRoles } from '../../../src/modules/staff/staff-roles.js';
import { API, type Fixture, NOW, type Person, useBookingWorld } from './booking-world.js';

interface Week {
  from: string;
  to: string;
  today: string;
  providerId: string;
  slots: {
    startsAt: string;
    status: string;
    appointment: { id: string; status: string; patient: object } | null;
  }[];
  truncated: boolean;
  absences: { startsAt: string; endsAt: string; reason: string }[];
}

describe('the calendar on real databases (08 M05, W2)', () => {
  const world = useBookingWorld({ PRACTICE_SLUG: 'al-noor' });
  let team: Person;

  const member = async (): Promise<Person> => {
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
    return {
      ...who,
      token: (confirmed.body as { tokens: { accessToken: string } }).tokens.accessToken,
    };
  };
  const desk = (fixture: Fixture, path: string): string =>
    `${API}/practices/${fixture.practice.practiceId}/desk/${path}`;
  const auditCount = (action: string, subjectId: string): Promise<number> =>
    world.asOwner(world.alNoor(), async (owner) => {
      const { rows } = await owner.query<{ count: string }>(
        'SELECT count(*) FROM audit_events WHERE action = $1 AND subject_id = $2',
        [action, subjectId],
      );
      return Number(rows[0]?.count ?? 0);
    });

  beforeAll(async () => {
    team = await member();
  });

  it('shows a doctor’s week: free, booked and freed times, and the absences', async () => {
    const practice = world.alNoor();
    const patientId = await world.join(await world.person(), practice);
    const [free, booked, freed] = [world.freshTime(), world.freshTime(), world.freshTime()];
    for (const startsAt of [free, booked, freed]) await world.slotAt(practice, startsAt);
    const book = async (startsAt: Temporal.Instant): Promise<string> => {
      const answer = await world
        .send(request(world.server()).post(desk(practice, 'appointments')), team)
        .set('Idempotency-Key', randomUUID())
        .send({ patientId, serviceId: practice.serviceId, startsAt: startsAt.toString() })
        .expect(201);
      return (answer.body as { id: string }).id;
    };
    const holder = await book(booked);
    const cancelled = await book(freed);
    await world
      .send(request(world.server()).post(desk(practice, `appointments/${cancelled}/cancel`)), team)
      .send({ cancelReason: 'Synthetic reason: the doctor is away.' })
      .expect(200);
    // A free time whose rule is gone only keeps history: nobody can book it, so it is not shown.
    const history = world.freshTime();
    await world.asOwner(practice, (owner) =>
      owner.query(
        `INSERT INTO slots (provider_id, rule_id, starts_at, ends_at, status)
         VALUES ($1, NULL, $2, $3, 'OPEN')`,
        [practice.providerId, history.toString(), history.add({ minutes: 30 }).toString()],
      ),
    );
    // Training tomorrow morning: no slot exists in it, the calendar shows it as an absence.
    const away = NOW.add({ hours: 24 });
    await world.asOwner(practice, (owner) =>
      owner.query(
        `INSERT INTO availability_exceptions (provider_id, starts_at, ends_at, reason)
         VALUES ($1, $2, $3, 'TRAINING')`,
        [practice.providerId, away.toString(), away.add({ hours: 2 }).toString()],
      ),
    );

    const answer = await world
      .send(
        request(world.server())
          .get(desk(practice, 'week'))
          .query({ providerId: practice.providerId }),
        team,
      )
      .expect(200);
    const week = answer.body as Week;
    expect(week).toMatchObject({
      from: '2026-11-15',
      to: '2026-11-21',
      today: '2026-11-15',
      providerId: practice.providerId,
    });
    const at = (startsAt: Temporal.Instant) =>
      week.slots.find((slot) => Temporal.Instant.from(slot.startsAt).equals(startsAt));
    expect(at(free)).toMatchObject({ status: 'OPEN', appointment: null });
    expect(at(booked)).toMatchObject({
      status: 'BOOKED',
      appointment: { id: holder, status: 'BOOKED' },
    });
    // A cancel frees the time: the calendar shows it free, without the cancelled appointment.
    expect(at(freed)).toMatchObject({ status: 'OPEN', appointment: null });
    expect(at(history)).toBeUndefined();
    // Who, what and its status, and no more (data minimisation).
    expect(Object.keys(at(booked)?.appointment ?? {}).toSorted()).toEqual([
      'id',
      'patient',
      'serviceName',
      'status',
    ]);
    expect(at(booked)?.appointment?.patient).toEqual({
      firstName: 'Sami',
      lastName: 'Beispiel',
    });
    expect(week.truncated).toBe(false);
    expect(week.absences).toContainEqual({
      startsAt: away.toString(),
      endsAt: away.add({ hours: 2 }).toString(),
      reason: 'TRAINING',
    });
    // Only this doctor's times, in the order of time.
    const starts = week.slots.map(({ startsAt }) => Temporal.Instant.from(startsAt));
    expect(starts).toEqual(starts.toSorted((a, b) => Temporal.Instant.compare(a, b)));
    expect(await auditCount('appointment.list', holder)).toBe(1);
    expect(await auditCount('appointment.list', cancelled)).toBe(0);
  });

  it('answers another week, and refuses an unknown doctor and a missing one', async () => {
    const practice = world.alNoor();
    const later = await world
      .send(
        request(world.server())
          .get(desk(practice, 'week'))
          .query({ providerId: practice.providerId, from: '2026-11-22' }),
        team,
      )
      .expect(200);
    expect(later.body).toMatchObject({ from: '2026-11-22', to: '2026-11-28', today: '2026-11-15' });
    const unknown = await world
      .send(
        request(world.server()).get(desk(practice, 'week')).query({ providerId: randomUUID() }),
        team,
      )
      .expect(404);
    expect(unknown.body).toMatchObject({ code: 'NOT_FOUND' });
    const missing = await world
      .send(request(world.server()).get(desk(practice, 'week')), team)
      .expect(400);
    expect(missing.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('asks a patient for the second factor before anything else', async () => {
    const practice = world.alNoor();
    const patient = await world.patient(practice);
    const refused = await world
      .send(
        request(world.server())
          .get(desk(practice, 'week'))
          .query({ providerId: practice.providerId }),
        patient,
      )
      .expect(403);
    expect(refused.body).toMatchObject({ code: 'MFA_REQUIRED' });
  });
});

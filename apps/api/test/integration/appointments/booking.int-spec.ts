/**
 * Booking an appointment against real databases (08 B02): the rules, the key and the access to a
 * practice. What happens at the same time is in booking.concurrency.int-spec.ts.
 */
import { randomUUID } from 'node:crypto';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { PracticeConnectionManager } from '../../../src/common/tenancy/practice-connection-manager.js';
import { PracticeKeys } from '../../../src/common/tenancy/practice-keys.js';
import {
  IDEMPOTENCY_KEY_SWEEP_JOB,
  IdempotencyKeySweepJob,
} from '../../../src/modules/appointments/idempotency-key-sweep.job.js';
import { API, NOW, useBookingWorld } from './booking-world.js';

const INSURED = {
  firstName: 'Sami',
  lastName: 'Beispiel',
  dateOfBirth: '1990-04-12',
  insuranceType: 'PUBLIC',
  insuranceProvider: 'Synthetic Health',
  insuranceNumber: 'A123456789',
};

interface AppointmentBody {
  id: string;
  patientId: string;
  serviceId: string;
  providerId: string | null;
  startsAt: string;
  status: string;
}

describe('booking an appointment on real databases (08 B02)', () => {
  const world = useBookingWorld();
  const statusOf = async (test: request.Test): Promise<number> => (await test).status;

  describe('a booking', () => {
    it('takes the slot of that time for the own profile, and says what it booked', async () => {
      const practice = world.alNoor();
      const who = await world.person();
      const patientId = await world.join(who, practice);
      const startsAt = await world.freshSlot(practice);
      const response = await world
        .book(who, practice, { serviceId: practice.serviceId, startsAt: startsAt.toString() })
        .expect(201);
      const body = response.body as AppointmentBody;
      expect(body).toMatchObject({
        patientId,
        serviceId: practice.serviceId,
        providerId: practice.providerId,
        startsAt: startsAt.toString(),
        status: 'BOOKED',
      });
      await expect(world.activeAt(practice, startsAt)).resolves.toEqual([
        { id: body.id, slot_status: 'BOOKED' },
      ]);
    });

    it('stores a note encrypted, says nothing of it, and audits the booking', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = await world.freshSlot(practice);
      const note = 'Synthetic note\nover two lines';
      const response = await world
        .book(who, practice, {
          serviceId: practice.serviceId,
          startsAt: startsAt.toString(),
          patientNote: note,
        })
        .expect(201);
      const { id } = response.body as AppointmentBody;
      expect(response.text).not.toContain('Synthetic note');
      const stored = await world.asOwner(practice, async (owner) => {
        const { rows } = await owner.query<{ patient_note_encrypted: string }>(
          'SELECT patient_note_encrypted FROM appointments WHERE id = $1',
          [id],
        );
        const audit = await owner.query<{ action: string; ip_hash: string }>(
          'SELECT action, ip_hash FROM audit_events WHERE subject_id = $1',
          [id],
        );
        return { note: rows[0]?.patient_note_encrypted ?? '', audit: audit.rows };
      });
      expect(stored.note).not.toContain('Synthetic');
      await expect(
        world
          .app()
          .get(PracticeKeys)
          .decrypt(practice.practice.practiceId, stored.note, `appointment:${id}:patient-note`),
      ).resolves.toBe(note);
      expect(stored.audit).toEqual([
        { action: 'appointment.book', ip_hash: expect.any(String) as string },
      ]);
    });

    it('takes any doctor free at that time, and the named one when asked', async () => {
      const practice = world.alNoor();
      const startsAt = world.freshTime();
      await world.slotAt(practice, startsAt);
      await world.slotAt(practice, startsAt, { other: true });
      const first = await world.patient(practice);
      const second = await world.patient(practice);
      const third = await world.patient(practice);
      const named = await world
        .book(first, practice, {
          serviceId: practice.serviceId,
          startsAt: startsAt.toString(),
          providerId: practice.providerId,
        })
        .expect(201);
      expect((named.body as AppointmentBody).providerId).toBe(practice.providerId);
      const any = await world
        .book(second, practice, { serviceId: practice.serviceId, startsAt: startsAt.toString() })
        .expect(201);
      // The seed's other doctor has no public profile: that slot is booked, and no name is given.
      expect((any.body as AppointmentBody).providerId).toBeNull();
      const refused = await world
        .book(third, practice, { serviceId: practice.serviceId, startsAt: startsAt.toString() })
        .expect(409);
      expect(refused.body).toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
    });

    it('never names a doctor without a public profile, also when any doctor led there (BR-24)', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = world.freshTime();
      await world.slotAt(practice, startsAt, { other: true });
      const body = { serviceId: practice.serviceId, startsAt: startsAt.toString() };
      expect(
        await statusOf(
          world.book(who, practice, { ...body, providerId: practice.otherProviderId }),
        ),
      ).toBe(404);

      const any = await world.book(who, practice, body).expect(201);
      expect((any.body as AppointmentBody).providerId).toBeNull();
      const booked = await world.asOwner(practice, async (owner) => {
        const { rows } = await owner.query<{ provider_id: string }>(
          'SELECT s.provider_id FROM appointments a JOIN slots s ON s.id = a.slot_id WHERE a.id = $1',
          [(any.body as AppointmentBody).id],
        );
        return rows[0]?.provider_id;
      });
      expect(booked).toBe(practice.otherProviderId);
    });

    it('stops naming a doctor as soon as the consent is withdrawn (BR-24)', async () => {
      const practice = world.lindenhof();
      const who = await world.patient(practice);
      const startsAt = await world.freshSlot(practice);
      const body = { serviceId: practice.serviceId, startsAt: startsAt.toString() };
      const key = randomUUID();
      const first = await world.book(who, practice, body, key).expect(201);
      expect((first.body as AppointmentBody).providerId).toBe(practice.providerId);

      const withdrawn = await world.asOwner(practice, async (owner) => {
        const { rows } = await owner.query<{ id: string }>(
          "UPDATE staff_consents SET withdrawn_at = now() WHERE staff_member_id = $1 AND type = 'PUBLIC_PROFILE' AND withdrawn_at IS NULL RETURNING id",
          [practice.providerId],
        );
        return rows.map(({ id }) => id);
      });
      const replay = await world.book(who, practice, body, key).expect(201);
      expect((replay.body as AppointmentBody).providerId).toBeNull();
      await world.asOwner(practice, (owner) =>
        owner.query('UPDATE staff_consents SET withdrawn_at = NULL WHERE id = ANY($1::uuid[])', [
          withdrawn,
        ]),
      );
    });
  });

  describe('one person at a time', () => {
    it('takes ten bookings a minute from one address, and then says when to come back', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const body = { serviceId: practice.serviceId, startsAt: world.freshTime().toString() };
      const answers: request.Response[] = [];
      for (let attempt = 0; attempt < 11; attempt += 1) {
        answers.push(await world.book(who, practice, body).set('X-Forwarded-For', '203.0.113.7'));
      }
      expect(answers.slice(0, 10).map(({ status }) => status)).toEqual(Array(10).fill(409));
      expect(answers[10]?.status).toBe(429);
      expect(answers[10]?.body).toMatchObject({ code: 'RATE_LIMITED' });
      expect(answers[10]?.headers['retry-after']).toEqual(expect.any(String));
    });

    it('holds one account to a part of the connections, whatever addresses it has', async () => {
      const practice = world.alNoor();
      const flooder = await world.patient(practice);
      const other = await world.patient(practice);
      const nothingThere = world.freshTime().toString();
      const startsAt = await world.freshSlot(practice);
      const flood = Promise.all(
        Array.from({ length: 60 }, () =>
          world.book(flooder, practice, {
            serviceId: practice.serviceId,
            startsAt: nothingThere,
          }),
        ),
      );
      const [answers, booked] = await Promise.all([
        flood,
        world.book(other, practice, {
          serviceId: practice.serviceId,
          startsAt: startsAt.toString(),
        }),
      ]);
      expect(booked.status).toBe(201);
      const codes = answers.map(({ body }) => (body as { code?: string }).code);
      expect(new Set(codes)).toEqual(new Set(['SLOT_NOT_AVAILABLE', 'RATE_LIMITED']));
      const limited = answers.find(({ status }) => status === 429);
      expect(limited?.headers['retry-after']).toBe('1');
    });
  });

  describe('BR-01', () => {
    it('refuses a time that is taken, and one that has no slot', async () => {
      const practice = world.alNoor();
      const startsAt = await world.freshSlot(practice);
      const first = await world.patient(practice);
      const second = await world.patient(practice);
      const body = { serviceId: practice.serviceId, startsAt: startsAt.toString() };
      await world.book(first, practice, body).expect(201);
      const taken = await world.book(second, practice, body).expect(409);
      expect(taken.body).toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
      const none = await world
        .book(second, practice, { ...body, startsAt: world.freshTime().toString() })
        .expect(409);
      expect(none.body).toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
    });

    it('refuses a blocked slot', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = world.freshTime();
      await world.slotAt(practice, startsAt, { status: 'BLOCKED' });
      const response = await world
        .book(who, practice, { serviceId: practice.serviceId, startsAt: startsAt.toString() })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
    });

    it('rejects a second active row in raw SQL, by the index of the database', async () => {
      const practice = world.alNoor();
      const who = await world.person();
      const patientId = await world.join(who, practice);
      const startsAt = await world.freshSlot(practice);
      const { body } = (await world
        .book(who, practice, { serviceId: practice.serviceId, startsAt: startsAt.toString() })
        .expect(201)) as { body: AppointmentBody };
      const insert = `INSERT INTO appointments (patient_id, slot_id, service_id, booked_by_id, booked_at, status)
        SELECT $1, slot_id, service_id, booked_by_id, booked_at, $3::appointment_status FROM appointments WHERE id = $2`;
      await expect(
        world.asOwner(practice, (owner) => owner.query(insert, [patientId, body.id, 'BOOKED'])),
      ).rejects.toThrow(/appointments_slot_active_key/u);
      // A cancelled appointment holds no slot: the index allows it.
      await expect(
        world.asOwner(practice, (owner) => owner.query(insert, [patientId, body.id, 'CANCELLED'])),
      ).resolves.toBeDefined();
    });
  });

  describe('BR-02', () => {
    it('counts per patient, in the future, and only what is still to come', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const book = async (): Promise<request.Response> =>
        world.book(who, practice, {
          serviceId: practice.serviceId,
          startsAt: (await world.freshSlot(practice)).toString(),
        });
      const first = await book();
      expect(first.status).toBe(201);
      expect((await book()).status).toBe(201);
      const third = await book();
      expect(third.status).toBe(409);
      expect(third.body).toMatchObject({
        code: 'BOOKING_LIMIT_REACHED',
        params: { maxFutureAppointments: 2 },
      });

      // Once one has passed, there is a place again: the clock has moved, so a new sign-in too.
      const { startsAt } = first.body as AppointmentBody;
      world.clock.set(Temporal.Instant.from(startsAt).add({ minutes: 1 }));
      const later = world.freshTime().add({ hours: 30 * 24 });
      await world.slotAt(practice, later);
      await world
        .book({ ...who, token: await world.signIn(who.email) }, practice, {
          serviceId: practice.serviceId,
          startsAt: later.toString(),
        })
        .expect(201);
    });
  });

  describe('BR-03', () => {
    const LEAD = NOW.add({ minutes: 120 });
    const HORIZON = NOW.add({ hours: 90 * 24 });

    const OUTSIDE = { status: 409, code: 'OUTSIDE_BOOKING_WINDOW' };
    const BOOKED = { status: 201, code: undefined };

    it.each([
      ['one minute before the lead time', LEAD.subtract({ minutes: 1 }), OUTSIDE],
      ['at the lead time', LEAD, BOOKED],
      ['at the horizon', HORIZON, BOOKED],
      ['one minute after the horizon', HORIZON.add({ minutes: 1 }), OUTSIDE],
    ])('%s', async (_, startsAt, expected) => {
      const practice = world.lindenhof();
      const who = await world.patient(practice);
      await world.slotAt(practice, startsAt);
      const response = await world.book(who, practice, {
        serviceId: practice.serviceId,
        startsAt: startsAt.toString(),
      });
      expect({
        status: response.status,
        code: (response.body as { code?: string }).code,
      }).toEqual(expected);
      await world.asOwner(practice, async (owner) => {
        await owner.query('DELETE FROM appointments');
        await owner.query("UPDATE slots SET status = 'OPEN' WHERE status = 'BOOKED'");
        await owner.query('DELETE FROM slots WHERE starts_at = $1', [startsAt.toString()]);
      });
    });

    it('takes a time with another offset for the instant it names', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = await world.freshSlot(practice);
      const inRiyadh = startsAt
        .toZonedDateTimeISO('Asia/Riyadh')
        .toString({ timeZoneName: 'never' });
      const response = await world
        .book(who, practice, { serviceId: practice.serviceId, startsAt: inRiyadh })
        .expect(201);
      expect((response.body as AppointmentBody).startsAt).toBe(startsAt.toString());
    });

    it('refuses what is no time', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      for (const startsAt of ['2026-02-31T10:00:00Z', '2026-11-20', '2026-11-20T10:00:00']) {
        expect(
          await statusOf(world.book(who, practice, { serviceId: practice.serviceId, startsAt })),
        ).toBe(400);
      }
    });
  });

  describe('BR-08', () => {
    it('refuses a service that cannot be booked online, and one that does not exist', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = await world.freshSlot(practice);
      for (const serviceId of [practice.notOnlineServiceId, randomUUID()]) {
        const response = await world
          .book(who, practice, { serviceId, startsAt: startsAt.toString() })
          .expect(409);
        expect(response.body).toMatchObject({ code: 'SERVICE_NOT_BOOKABLE' });
      }
    });

    it('refuses a service that does not allow the insurance type', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice, INSURED);
      const startsAt = await world.freshSlot(practice);
      await world.asOwner(practice, (owner) =>
        owner.query("UPDATE services SET allowed_insurance_types = '{SELF_PAY}' WHERE id = $1", [
          practice.serviceId,
        ]),
      );
      const response = await world
        .book(who, practice, { serviceId: practice.serviceId, startsAt: startsAt.toString() })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'SERVICE_NOT_BOOKABLE' });
      await world.asOwner(practice, (owner) =>
        owner.query("UPDATE services SET allowed_insurance_types = '{}' WHERE id = $1", [
          practice.serviceId,
        ]),
      );
    });

    it('refuses a slot whose rule does not offer that service', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = await world.freshSlot(practice);
      await world.asOwner(practice, (owner) =>
        owner.query('UPDATE slots SET rule_id = NULL WHERE starts_at = $1', [startsAt.toString()]),
      );
      const response = await world
        .book(who, practice, { serviceId: practice.serviceId, startsAt: startsAt.toString() })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
    });
  });

  describe('the Idempotency-Key', () => {
    it('answers a replay with the first booking, and books nothing more', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = await world.freshSlot(practice);
      const key = randomUUID();
      const body = { serviceId: practice.serviceId, startsAt: startsAt.toString() };
      const first = await world.book(who, practice, body, key).expect(201);
      const replay = await world.book(who, practice, body, key).expect(201);
      expect(replay.body).toEqual(first.body);
      await expect(world.activeAt(practice, startsAt)).resolves.toHaveLength(1);
    });

    it('refuses the same key with another request', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const key = randomUUID();
      const first = await world.freshSlot(practice);
      const second = await world.freshSlot(practice);
      await world
        .book(who, practice, { serviceId: practice.serviceId, startsAt: first.toString() }, key)
        .expect(201);
      const response = await world
        .book(who, practice, { serviceId: practice.serviceId, startsAt: second.toString() }, key)
        .expect(409);
      expect(response.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      await expect(world.activeAt(practice, second)).resolves.toEqual([]);
    });

    it('takes another note as another request', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const key = randomUUID();
      const startsAt = await world.freshSlot(practice);
      const body = { serviceId: practice.serviceId, startsAt: startsAt.toString() };
      await world.book(who, practice, { ...body, patientNote: 'first' }, key).expect(201);
      const response = await world.book(who, practice, { ...body, patientNote: 'second' }, key);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    });

    it('stores no request and no note, only a hash that differs per practice', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = await world.freshSlot(practice);
      const key = randomUUID();
      await world
        .book(
          who,
          practice,
          {
            serviceId: practice.serviceId,
            startsAt: startsAt.toString(),
            patientNote: 'Synthetic',
          },
          key,
        )
        .expect(201);
      const row = await world.asOwner(practice, async (owner) => {
        const { rows } = await owner.query<{ request_hash: string }>(
          'SELECT request_hash FROM idempotency_keys WHERE key = $1',
          [key],
        );
        return rows[0];
      });
      expect(row?.request_hash).toMatch(/^[\w-]{43}$/u);
    });

    it('is per caller: another person with the same key books for themselves', async () => {
      const practice = world.alNoor();
      const first = await world.patient(practice);
      const second = await world.patient(practice);
      const key = randomUUID();
      const firstTime = await world.freshSlot(practice);
      const secondTime = await world.freshSlot(practice);
      const mine = await world
        .book(
          first,
          practice,
          { serviceId: practice.serviceId, startsAt: firstTime.toString() },
          key,
        )
        .expect(201);
      const theirs = await world
        .book(
          second,
          practice,
          { serviceId: practice.serviceId, startsAt: secondTime.toString() },
          key,
        )
        .expect(201);
      expect((theirs.body as AppointmentBody).id).not.toBe((mine.body as AppointmentBody).id);
    });

    it('lets a retry try again after a failure', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = world.freshTime();
      const key = randomUUID();
      const body = { serviceId: practice.serviceId, startsAt: startsAt.toString() };
      expect(await statusOf(world.book(who, practice, body, key))).toBe(409);
      await world.slotAt(practice, startsAt);
      expect(await statusOf(world.book(who, practice, body, key))).toBe(201);
    });

    it('forgets a key after 24 hours', async () => {
      const practice = world.lindenhof();
      await world.setRules(practice, { limit: 10 });
      const who = await world.patient(practice);
      const key = randomUUID();
      const first = await world.freshSlot(practice);
      await world
        .book(who, practice, { serviceId: practice.serviceId, startsAt: first.toString() }, key)
        .expect(201);
      await world.asOwner(practice, (owner) =>
        owner.query(
          "UPDATE idempotency_keys SET created_at = created_at - interval '25 hours' WHERE key = $1",
          [key],
        ),
      );
      const second = await world.freshSlot(practice);
      expect(
        await statusOf(
          world.book(
            who,
            practice,
            { serviceId: practice.serviceId, startsAt: second.toString() },
            key,
          ),
        ),
      ).toBe(201);
      await world.setRules(practice);
    });

    it('goes after 24 hours in every practice, also when that person never books again', async () => {
      const [alNoor, lindenhof] = [world.alNoor(), world.lindenhof()];
      const keysIn = (practice: typeof alNoor): Promise<readonly string[]> =>
        world.asOwner(practice, async (owner) => {
          const { rows } = await owner.query<{ key: string }>('SELECT key FROM idempotency_keys');
          return rows.map(({ key }) => key);
        });
      const age = (practice: typeof alNoor, key: string): Promise<unknown> =>
        world.asOwner(practice, (owner) =>
          owner.query(
            "UPDATE idempotency_keys SET created_at = created_at - interval '25 hours' WHERE key = $1",
            [key],
          ),
        );
      const bookWith = async (practice: typeof alNoor, key: string): Promise<void> => {
        const who = await world.patient(practice);
        const startsAt = await world.freshSlot(practice);
        await world
          .book(
            who,
            practice,
            { serviceId: practice.serviceId, startsAt: startsAt.toString() },
            key,
          )
          .expect(201);
      };
      const [oldKey, otherOldKey, recentKey] = [randomUUID(), randomUUID(), randomUUID()];
      await bookWith(alNoor, oldKey);
      await bookWith(lindenhof, otherOldKey);
      await bookWith(alNoor, recentKey);
      await age(alNoor, oldKey);
      await age(lindenhof, otherOldKey);

      const job = world.app().get(IdempotencyKeySweepJob);
      await expect(job.run()).resolves.toMatchObject({ failed: 0 });

      await expect(keysIn(alNoor)).resolves.not.toContain(oldKey);
      await expect(keysIn(lindenhof)).resolves.not.toContain(otherOldKey);
      await expect(keysIn(alNoor)).resolves.toContain(recentKey);
      expect(
        world.app().get(SchedulerRegistry).getCronJob(IDEMPOTENCY_KEY_SWEEP_JOB),
      ).toBeDefined();
    });

    it('is required, and a UUID', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = await world.freshSlot(practice);
      const body = { serviceId: practice.serviceId, startsAt: startsAt.toString() };
      const missing = await request(world.server())
        .post(`${API}/practices/${practice.practice.practiceId}/appointments`)
        .set('Authorization', `Bearer ${who.token}`)
        .send(body)
        .expect(400);
      expect(missing.body).toMatchObject({
        errors: [{ field: 'Idempotency-Key', code: 'REQUIRED' }],
      });
      const wrong = await world.book(who, practice, body, 'not-a-uuid').expect(400);
      expect(wrong.body).toMatchObject({
        errors: [{ field: 'Idempotency-Key', code: 'INVALID_VALUE' }],
      });
    });
  });

  describe('who may book', () => {
    it('answers EMAIL_NOT_VERIFIED for an account that is not confirmed (BR-09)', async () => {
      const practice = world.alNoor();
      const who = await world.person({ confirmed: false });
      const startsAt = await world.freshSlot(practice);
      const acquire = vi.spyOn(world.app().get(PracticeConnectionManager), 'acquire');
      const response = await world
        .book(who, practice, { serviceId: practice.serviceId, startsAt: startsAt.toString() })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
      expect(acquire).not.toHaveBeenCalled();
      acquire.mockRestore();
    });

    it('asks for the details first when a profile no longer meets the practice (BR-09)', async () => {
      const practice = world.lindenhof();
      const who = await world.patient(practice);
      const startsAt = await world.freshSlot(practice);
      const body = { serviceId: practice.serviceId, startsAt: startsAt.toString() };
      await world.asOwner(practice, (owner) =>
        owner.query(
          "UPDATE practice_settings SET insurance_types = array_remove(insurance_types, 'SELF_PAY')",
        ),
      );
      const refused = await world.book(who, practice, body).expect(409);
      expect(refused.body).toMatchObject({ code: 'PATIENT_PROFILE_INCOMPLETE' });
      await world.asOwner(practice, (owner) =>
        owner.query(
          "UPDATE practice_settings SET insurance_types = array_append(insurance_types, 'SELF_PAY')",
        ),
      );
      expect(await statusOf(world.book(who, practice, body))).toBe(201);
    });

    it('answers 401 without a sign-in, 404 before a join, and 404 in another practice', async () => {
      const practice = world.alNoor();
      const startsAt = await world.freshSlot(practice);
      const body = { serviceId: practice.serviceId, startsAt: startsAt.toString() };
      expect(await statusOf(world.book(undefined, practice, body))).toBe(401);
      const stranger = await world.person();
      expect(await statusOf(world.book(stranger, practice, body))).toBe(404);

      const elsewhere = await world.patient(world.lindenhof());
      const acquire = vi.spyOn(world.app().get(PracticeConnectionManager), 'acquire');
      expect(await statusOf(world.book(elsewhere, practice, body))).toBe(404);
      expect(acquire).not.toHaveBeenCalled();
      acquire.mockRestore();
      await expect(world.activeAt(practice, startsAt)).resolves.toEqual([]);
    });

    it('answers 403 for another capacity', async () => {
      const practice = world.alNoor();
      const staff = await world.person();
      await world.platform().practiceAccess.create({
        data: {
          userId: staff.userId,
          practiceId: practice.practice.practiceId,
          capacity: 'STAFF',
          active: true,
        },
      });
      const startsAt = await world.freshSlot(practice);
      expect(
        await statusOf(
          world.book(staff, practice, {
            serviceId: practice.serviceId,
            startsAt: startsAt.toString(),
          }),
        ),
      ).toBe(403);
    });

    it('takes who books from the token: a patient id in the body is refused', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = await world.freshSlot(practice);
      expect(
        await statusOf(
          world.book(who, practice, {
            serviceId: practice.serviceId,
            startsAt: startsAt.toString(),
            patientId: randomUUID(),
          }),
        ),
      ).toBe(400);
    });
  });
});

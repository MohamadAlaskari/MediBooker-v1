/**
 * Booking for a patient on real databases (08 M05, W7): the team's free times, a booking on the
 * phone or at the desk with the rules for the team, and a patient without an account.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, stepOf } from '../../../src/modules/auth/domain/totp.js';
import { StaffRoles } from '../../../src/modules/staff/staff-roles.js';
import { API, type Fixture, NOW, type Person, useBookingWorld } from './booking-world.js';

const SLUG = 'al-noor';

interface Row {
  id: string;
  status: string;
  bookedOnline: boolean;
  providerId: string;
  serviceId: string;
  startsAt: string;
  patient: { id: string };
}

describe('booking for a patient on real databases (08 M05, W7)', () => {
  const world = useBookingWorld({ PRACTICE_SLUG: SLUG });
  let team: Person;

  /** A member of the team, signed in with both factors (A04). */
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
  const book = (body: object, key: string = randomUUID(), who: Person = team): request.Test =>
    world
      .send(request(world.server()).post(desk(world.alNoor(), 'appointments')), who)
      .set('Idempotency-Key', key)
      .send(body);
  const freeTimes = async (query: Record<string, string>): Promise<string[]> => {
    const answer = await world
      .send(request(world.server()).get(desk(world.alNoor(), 'free-times')).query(query), team)
      .expect(200);
    return (answer.body as { times: { startsAt: string }[] }).times.map(({ startsAt }) =>
      Temporal.Instant.from(startsAt).toString(),
    );
  };
  const auditCount = (action: string, subjectId: string): Promise<number> =>
    world.asOwner(world.alNoor(), async (owner) => {
      const { rows } = await owner.query<{ count: string }>(
        'SELECT count(*) FROM audit_events WHERE action = $1 AND subject_id = $2',
        [action, subjectId],
      );
      return Number(rows[0]?.count ?? 0);
    });
  const dayOf = (startsAt: Temporal.Instant): string =>
    startsAt.toZonedDateTimeISO('Asia/Riyadh').toPlainDate().toString();

  beforeAll(async () => {
    const practice = world.alNoor();
    // What the practice asks of every patient (BR-10), named here so that the test can read it.
    await world.asOwner(practice, async (owner) => {
      await owner.query(
        `UPDATE practice_settings SET insurance_types = '{PUBLIC,SELF_PAY}',
           insurance_provider_types = '{PUBLIC}', insurance_number_types = '{PUBLIC}'`,
      );
      // The other doctor's rule also offers the service that patients cannot book online.
      await owner.query(
        `INSERT INTO availability_rule_services (rule_id, service_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [practice.otherRuleId, practice.notOnlineServiceId],
      );
    });
    team = await member();
  });

  describe('the team’s free times', () => {
    it('offers every active service and doctor from now on, also within the patients’ lead time', async () => {
      const practice = world.alNoor();
      // 47 minutes from now: inside the two hours of lead time that patients keep, and before the
      // first of the fresh times, which lie beyond it.
      const soon = NOW.add({ minutes: 47 });
      await world.slotAt(practice, soon, { other: true });
      const date = dayOf(soon);
      expect(await freeTimes({ serviceId: practice.serviceId, date })).toContain(soon.toString());
      expect(await freeTimes({ serviceId: practice.notOnlineServiceId, date })).toContain(
        soon.toString(),
      );
      expect(
        await freeTimes({
          serviceId: practice.serviceId,
          providerId: practice.otherProviderId,
          date,
        }),
      ).toContain(soon.toString());
      const days = await world
        .send(
          request(world.server())
            .get(desk(practice, 'availability'))
            .query({ serviceId: practice.serviceId, from: date, to: date }),
          team,
        )
        .expect(200);
      expect(days.body).toEqual({ days: [{ date, hasFreeTimes: true }] });
      // A patient keeps the lead time: the public page does not offer it.
      const offered = await request(world.server())
        .get(`${API}/public/practices/${SLUG}/slots`)
        .query({ serviceId: practice.serviceId, date })
        .expect(200);
      expect(JSON.stringify(offered.body)).not.toContain(soon.toString());
    });

    it('answers 404 for a service or doctor of no practice here', async () => {
      const practice = world.alNoor();
      for (const query of [
        { serviceId: randomUUID(), date: dayOf(NOW) },
        { serviceId: practice.serviceId, providerId: randomUUID(), date: dayOf(NOW) },
      ]) {
        const refused = await world
          .send(request(world.server()).get(desk(practice, 'free-times')).query(query), team)
          .expect(404);
        expect(refused.body).toMatchObject({ code: 'NOT_FOUND' });
      }
    });
  });

  describe('a booking by the team', () => {
    it('books for a patient as the desk shows it, once per key, and audits it', async () => {
      const practice = world.alNoor();
      const patientId = await world.join(await world.person(), practice);
      const startsAt = world.freshTime();
      await world.slotAt(practice, startsAt);
      const key = randomUUID();
      const body = { patientId, serviceId: practice.serviceId, startsAt: startsAt.toString() };
      const first = await book(body, key).expect(201);
      expect(first.body).toMatchObject({
        status: 'BOOKED',
        bookedOnline: false,
        providerId: practice.providerId,
        serviceId: practice.serviceId,
        patient: { id: patientId },
      });
      const { id } = first.body as Row;
      const again = await book(body, key).expect(201);
      expect((again.body as Row).id).toBe(id);
      expect(await world.activeAt(practice, startsAt)).toEqual([{ id, slot_status: 'BOOKED' }]);
      expect(await auditCount('appointment.book_by_practice', id)).toBe(1);
      // The same key with another request is refused, as for a patient's own booking.
      const refused = await book({ ...body, startsAt: world.freshTime().toString() }, key).expect(
        409,
      );
      expect(refused.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    });

    it('books a service patients cannot book online, with a doctor without a public profile', async () => {
      const practice = world.alNoor();
      const patientId = await world.join(await world.person(), practice);
      const startsAt = world.freshTime();
      await world.slotAt(practice, startsAt, { other: true });
      const booked = await book({
        patientId,
        serviceId: practice.notOnlineServiceId,
        startsAt: startsAt.toString(),
        providerId: practice.otherProviderId,
      }).expect(201);
      expect(booked.body).toMatchObject({
        serviceId: practice.notOnlineServiceId,
        providerId: practice.otherProviderId,
      });
    });

    it('keeps the limit of future appointments and does not book one person twice at a time', async () => {
      const practice = world.alNoor();
      const patientId = await world.join(await world.person(), practice);
      const [first, second, third] = [world.freshTime(), world.freshTime(), world.freshTime()];
      for (const startsAt of [first, second, third]) await world.slotAt(practice, startsAt);
      // A second doctor at the first time: the person still cannot have two at once (BR-25).
      await world.slotAt(practice, first, { other: true });
      await book({ patientId, serviceId: practice.serviceId, startsAt: first.toString() }).expect(
        201,
      );
      const overlap = await book({
        patientId,
        serviceId: practice.serviceId,
        startsAt: first.toString(),
      }).expect(409);
      expect(overlap.body).toMatchObject({ code: 'APPOINTMENT_OVERLAP' });
      await book({ patientId, serviceId: practice.serviceId, startsAt: second.toString() }).expect(
        201,
      );
      const limit = await book({
        patientId,
        serviceId: practice.serviceId,
        startsAt: third.toString(),
      }).expect(409);
      expect(limit.body).toMatchObject({
        code: 'BOOKING_LIMIT_REACHED',
        params: { maxFutureAppointments: 2 },
      });
    });

    it('refuses a past time, a taken time, a patient of another practice and a missing key', async () => {
      const practice = world.alNoor();
      const patientId = await world.join(await world.person(), practice);
      const past = NOW.subtract({ hours: 1 });
      await world.slotAt(practice, past);
      const late = await book({
        patientId,
        serviceId: practice.serviceId,
        startsAt: past.toString(),
      }).expect(409);
      expect(late.body).toMatchObject({ code: 'OUTSIDE_BOOKING_WINDOW' });
      const taken = await book({
        patientId,
        serviceId: practice.serviceId,
        startsAt: world.freshTime().toString(),
      }).expect(409);
      expect(taken.body).toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
      const elsewhere = await world.join(await world.person(), world.lindenhof());
      const startsAt = world.freshTime();
      await world.slotAt(practice, startsAt);
      await book({
        patientId: elsewhere,
        serviceId: practice.serviceId,
        startsAt: startsAt.toString(),
      }).expect(404);
      await world
        .send(request(world.server()).post(desk(practice, 'appointments')), team)
        .send({ patientId, serviceId: practice.serviceId, startsAt: startsAt.toString() })
        .expect(400);
    });
  });

  describe('a patient without an account', () => {
    it('is added with what the practice asks, found by the search, and booked for', async () => {
      const practice = world.alNoor();
      const added = await world
        .send(request(world.server()).post(desk(practice, 'patients')), team)
        .send({
          firstName: 'نور',
          lastName: 'التجربة',
          dateOfBirth: '1979-03-14',
          phone: '+966 55 000 1234',
          insuranceType: 'PUBLIC',
          insuranceProvider: 'Synthetic Insurance',
          insuranceNumber: '12345678',
        })
        .expect(201);
      expect(added.body).toMatchObject({
        firstName: 'نور',
        hasAccount: false,
        insuranceProvider: 'Synthetic Insurance',
        nextAppointmentAt: null,
      });
      const { id } = added.body as { id: string };
      expect(await auditCount('patient.add_by_practice', id)).toBe(1);
      const found = await world
        .send(request(world.server()).post(desk(practice, 'patients/search')), team)
        .send({ query: 'نور التجربه' })
        .expect(200);
      expect((found.body as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([
        id,
      ]);
      // Its number only through its blind index, as for a patient who joined.
      const byNumber = await world
        .send(request(world.server()).post(desk(practice, 'patients/search')), team)
        .send({ query: '12345678' })
        .expect(200);
      expect((byNumber.body as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([
        id,
      ]);
      const startsAt = world.freshTime();
      await world.slotAt(practice, startsAt);
      await book({
        patientId: id,
        serviceId: practice.serviceId,
        startsAt: startsAt.toString(),
      }).expect(201);
    });

    it('asks the team to look first when the person may be there, and audits an add despite it', async () => {
      const practice = world.alNoor();
      const add = (body: object): request.Test =>
        world.send(request(world.server()).post(desk(practice, 'patients')), team).send(body);
      const person = {
        firstName: 'Rami',
        lastName: 'Beispiel',
        dateOfBirth: '1991-05-06',
        insuranceType: 'PUBLIC',
        insuranceProvider: 'Synthetic Insurance',
        insuranceNumber: '87654321',
      };
      await add(person).expect(201);
      // The same name and date of birth however written, or another person with the same number.
      for (const body of [
        { ...person, firstName: 'RAMI', lastName: 'beispiel', insuranceNumber: '11223344' },
        { ...person, firstName: 'Other', lastName: 'Example', dateOfBirth: '1970-01-01' },
      ]) {
        const refused = await add(body).expect(409);
        expect(refused.body).toMatchObject({ code: 'PATIENT_MAY_EXIST' });
      }
      const again = await add({ ...person, confirmDuplicate: true }).expect(201);
      const { id } = again.body as { id: string };
      expect(await auditCount('patient.add_by_practice_despite_match', id)).toBe(1);
      expect(await auditCount('patient.add_by_practice', id)).toBe(0);
    });

    it('names every field the practice asks for, and refuses an impossible date of birth', async () => {
      const practice = world.alNoor();
      const empty = await world
        .send(request(world.server()).post(desk(practice, 'patients')), team)
        .send({})
        .expect(400);
      const fields = (empty.body as { errors: { field: string; code: string }[] }).errors.map(
        ({ field, code }) => `${field}:${code}`,
      );
      expect(fields).toEqual(
        expect.arrayContaining([
          'firstName:REQUIRED',
          'lastName:REQUIRED',
          'dateOfBirth:REQUIRED',
          'insuranceType:REQUIRED',
        ]),
      );
      const insured = await world
        .send(request(world.server()).post(desk(practice, 'patients')), team)
        .send({
          firstName: 'Lina',
          lastName: 'Example',
          dateOfBirth: '2026-02-31',
          insuranceType: 'PUBLIC',
        })
        .expect(400);
      expect(
        (insured.body as { errors: { field: string; code: string }[] }).errors.map(
          ({ field, code }) => `${field}:${code}`,
        ),
      ).toEqual(
        expect.arrayContaining([
          'dateOfBirth:INVALID_VALUE',
          'insuranceProvider:REQUIRED',
          'insuranceNumber:REQUIRED',
        ]),
      );
    });

    it('asks a patient for the second factor before anything else', async () => {
      const practice = world.alNoor();
      const patient = await world.patient(practice);
      for (const path of ['appointments', 'patients']) {
        const refused = await world
          .send(request(world.server()).post(desk(practice, path)), patient)
          .set('Idempotency-Key', randomUUID())
          .send({})
          .expect(403);
        expect(refused.body).toMatchObject({ code: 'MFA_REQUIRED' });
      }
    });
  });
});

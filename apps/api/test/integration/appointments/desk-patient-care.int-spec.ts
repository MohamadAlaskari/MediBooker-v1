/**
 * The team's care for its patients on real databases (08 M04 part 3): a booking past the limit of
 * BR-02 with an audited reason, and a patient without an account corrected (Art. 16) and exported
 * for the person (Art. 15) (RT-97).
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, stepOf } from '../../../src/modules/auth/domain/totp.js';
import { StaffRoles } from '../../../src/modules/staff/staff-roles.js';
import { API, type Fixture, type Person, useBookingWorld } from './booking-world.js';

const REASON = 'Synthetic: the doctor asked for a follow-up within the week';

describe('the team’s care for its patients on real databases (08 M04 part 3)', () => {
  const world = useBookingWorld({ PRACTICE_SLUG: 'al-noor' });
  let team: Person;
  let admin: Person;

  /** A member of the team in a role, signed in with both factors (A04). */
  const member = async (role: 'STAFF' | 'DOCTOR' | 'ADMIN'): Promise<Person> => {
    const who = await world.person();
    await world.app().get(StaffRoles).setRole(who.email, role, 'local:test');
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
  const book = (body: object, key: string = randomUUID()): request.Test =>
    world
      .send(request(world.server()).post(desk(world.alNoor(), 'appointments')), team)
      .set('Idempotency-Key', key)
      .send(body);
  const add = (body: object): request.Test =>
    world.send(request(world.server()).post(desk(world.alNoor(), 'patients')), team).send(body);
  const change = (id: string, body: object, who: Person = team): request.Test =>
    world
      .send(request(world.server()).patch(desk(world.alNoor(), `patients/${id}`)), who)
      .send(body);
  const auditCount = (action: string, subjectId: string): Promise<number> =>
    world.asOwner(world.alNoor(), async (owner) => {
      const { rows } = await owner.query<{ count: string }>(
        'SELECT count(*) FROM audit_events WHERE action = $1 AND subject_id = $2',
        [action, subjectId],
      );
      return Number(rows[0]?.count ?? 0);
    });
  const columnOf = <T>(sql: string, id: string): Promise<T | undefined> =>
    world.asOwner(world.alNoor(), async (owner) => {
      const { rows } = await owner.query<{ value: T }>(sql, [id]);
      return rows[0]?.value;
    });
  const found = async (query: string): Promise<string[]> => {
    const answer = await world
      .send(request(world.server()).post(desk(world.alNoor(), 'patients/search')), team)
      .send({ query })
      .expect(200);
    return (answer.body as { items: { id: string }[] }).items.map((item) => item.id);
  };
  const insured = {
    dateOfBirth: '1982-07-19',
    insuranceType: 'PUBLIC',
    insuranceProvider: 'Synthetic Insurance',
  };

  beforeAll(async () => {
    // What the practice asks of every patient (BR-10), named here so that the test can read it.
    await world.asOwner(world.alNoor(), (owner) =>
      owner.query(
        `UPDATE practice_settings SET insurance_types = '{PUBLIC,SELF_PAY}',
           insurance_provider_types = '{PUBLIC}', insurance_number_types = '{PUBLIC}'`,
      ),
    );
    team = await member('STAFF');
    admin = await member('ADMIN');
  });

  describe('a booking past the limit (BR-02)', () => {
    it('books past the limit only with a reason, kept sealed and audited apart', async () => {
      const practice = world.alNoor();
      const person = await world.person();
      const patientId = await world.join(person, practice);
      const times = [world.freshTime(), world.freshTime(), world.freshTime()];
      for (const startsAt of times) await world.slotAt(practice, startsAt);
      const [first, second, third] = times.map((startsAt) => ({
        patientId,
        serviceId: practice.serviceId,
        startsAt: startsAt.toString(),
      })) as [object, object, object];
      // Within the limit a reason is not kept, and the booking is audited as any other.
      const within = await book({ ...first, limitOverrideReason: REASON }).expect(201);
      const withinId = (within.body as { id: string }).id;
      expect(
        await columnOf(
          'SELECT limit_override_reason_encrypted AS value FROM appointments WHERE id = $1',
          withinId,
        ),
      ).toBeNull();
      await book(second).expect(201);
      // The web's flow: the limit answered, then the same attempt, with its key, and a reason.
      const key = randomUUID();
      const refused = await book(third, key).expect(409);
      expect(refused.body).toMatchObject({
        code: 'BOOKING_LIMIT_REACHED',
        params: { maxFutureAppointments: 2 },
      });
      const past = await book({ ...third, limitOverrideReason: REASON }, key).expect(201);
      const { id } = past.body as { id: string };
      // The key again answers the first booking; with another reason it is another request.
      const replayed = await book({ ...third, limitOverrideReason: REASON }, key).expect(201);
      expect((replayed.body as { id: string }).id).toBe(id);
      const reused = await book(
        { ...third, limitOverrideReason: 'Synthetic: another reason' },
        key,
      ).expect(409);
      expect(reused.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      expect(await auditCount('appointment.book_by_practice_over_limit', id)).toBe(1);
      expect(await auditCount('appointment.book_by_practice', id)).toBe(0);
      const sealed = await columnOf<string>(
        'SELECT limit_override_reason_encrypted AS value FROM appointments WHERE id = $1',
        id,
      );
      expect(sealed).toEqual(expect.any(String));
      expect(sealed).not.toContain('follow-up');
      const details = await world
        .send(request(world.server()).get(desk(practice, `appointments/${id}`)), team)
        .expect(200);
      expect(details.body).toMatchObject({ limitOverrideReason: REASON });
      // The patient's own view never shows the team's reason.
      const own = await world
        .send(
          request(world.server()).get(
            `${API}/practices/${practice.practice.practiceId}/appointments/${id}`,
          ),
          person,
        )
        .expect(200);
      expect(JSON.stringify(own.body)).not.toContain('follow-up');
    });
  });

  describe('a patient without an account (RT-97)', () => {
    it('is corrected by the team, the number sealed and searchable anew, and audited', async () => {
      const added = await add({
        firstName: 'Hala',
        lastName: 'Exampel',
        phone: '+966 55 000 9876',
        insuranceNumber: '55667788',
        ...insured,
      }).expect(201);
      const { id } = added.body as { id: string };
      // Who added the profile (RT-97).
      expect(
        await columnOf<string>('SELECT added_by_id::text AS value FROM patients WHERE id = $1', id),
      ).toBe(team.userId);
      const changed = await change(id, {
        lastName: 'Example',
        phone: null,
        insuranceNumber: '99887766',
      }).expect(200);
      expect(changed.body).toEqual({
        id,
        firstName: 'Hala',
        lastName: 'Example',
        dateOfBirth: '1982-07-19',
        phone: null,
        insuranceType: 'PUBLIC',
        insuranceProvider: 'Synthetic Insurance',
        insuranceNumberEnd: '7766',
      });
      expect(await auditCount('patient.update_by_practice', id)).toBe(1);
      expect(await found('99887766')).toEqual([id]);
      expect(await found('55667788')).toEqual([]);
      // A type that keeps no number drops it, and its provider.
      const selfPay = await change(id, { insuranceType: 'SELF_PAY' }).expect(200);
      expect(selfPay.body).toMatchObject({
        insuranceType: 'SELF_PAY',
        insuranceProvider: null,
        insuranceNumberEnd: null,
      });
      expect(await found('99887766')).toEqual([]);
    });

    it('refuses a profile of an account, a match unless confirmed, and what is wrong', async () => {
      const practice = world.alNoor();
      const ofAccount = await world.join(await world.person(), practice);
      const kept = await change(ofAccount, { lastName: 'Other' }).expect(409);
      expect(kept.body).toMatchObject({ code: 'PATIENT_HAS_ACCOUNT' });
      // A child's profile (FA01) has no user of its own either: it is its guardian's, not the team's.
      const childId = randomUUID();
      await world.asOwner(practice, (owner) =>
        owner.query(
          `INSERT INTO patients (id, relationship, first_name, last_name, date_of_birth, insurance_type)
           VALUES ($1, 'CHILD', 'Synthetic', 'Child', '2019-03-04', 'SELF_PAY')`,
          [childId],
        ),
      );
      const ofGuardian = await change(childId, { lastName: 'Other' }).expect(409);
      expect(ofGuardian.body).toMatchObject({ code: 'PATIENT_HAS_ACCOUNT' });
      const first = await add({
        firstName: 'Omar',
        lastName: 'Probe',
        ...insured,
        insuranceNumber: '10203040',
      }).expect(201);
      const second = await add({
        firstName: 'Umar',
        lastName: 'Probe',
        ...insured,
        insuranceNumber: '50607080',
      }).expect(201);
      const firstId = (first.body as { id: string }).id;
      const secondId = (second.body as { id: string }).id;
      // Corrected into the name and date of birth of another patient, or into another's number.
      for (const body of [{ firstName: 'OMAR' }, { insuranceNumber: '10203040' }]) {
        const refused = await change(secondId, body).expect(409);
        expect(refused.body).toMatchObject({ code: 'PATIENT_MAY_EXIST' });
      }
      // Its own name and number are no match with itself.
      await change(firstId, { firstName: 'Omar', insuranceNumber: '10203040' }).expect(200);
      await change(secondId, { firstName: 'Omar', confirmDuplicate: true }).expect(200);
      expect(await auditCount('patient.update_by_practice_despite_match', secondId)).toBe(1);
      const wrong = await change(secondId, { dateOfBirth: '2026-02-31' }).expect(400);
      expect(wrong.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      await change(randomUUID(), { firstName: 'Nobody' }).expect(404);
      await change('not-an-id', { firstName: 'Nobody' }).expect(404);
    });

    it("gives an admin the person's copy with the whole number and every appointment, audited", async () => {
      const practice = world.alNoor();
      const added = await add({
        firstName: 'Mona',
        lastName: 'Copy',
        insuranceNumber: '31415926',
        ...insured,
      }).expect(201);
      const { id } = added.body as { id: string };
      // One visit with the doctor who has a public profile, one with the doctor who has none.
      const [startsAt, later] = [world.freshTime(), world.freshTime()];
      await world.slotAt(practice, startsAt);
      await world.slotAt(practice, later, { other: true });
      const booked = await book({
        patientId: id,
        serviceId: practice.serviceId,
        startsAt: startsAt.toString(),
      }).expect(201);
      const appointmentId = (booked.body as { id: string }).id;
      const withOther = await book({
        patientId: id,
        serviceId: practice.serviceId,
        startsAt: later.toString(),
        providerId: practice.otherProviderId,
      }).expect(201);
      const otherId = (withOther.body as { id: string }).id;
      const exportOf = (who: Person): request.Test =>
        world.send(request(world.server()).get(desk(practice, `patients/${id}/export`)), who);
      // Not for every role of the team: a copy holds the whole number.
      for (const who of [team, await member('DOCTOR')]) {
        const refused = await exportOf(who).expect(403);
        expect(refused.body).toMatchObject({ code: 'FORBIDDEN' });
      }
      const copy = await exportOf(admin).expect(200);
      expect(copy.headers['cache-control']).toBe('no-store');
      expect(copy.body).toMatchObject({
        timeZone: 'Asia/Riyadh',
        patient: {
          id,
          firstName: 'Mona',
          lastName: 'Copy',
          insuranceNumber: '31415926',
          hasAccount: false,
        },
        appointments: [
          {
            id: appointmentId,
            providerName: expect.stringMatching(/\S/u) as unknown,
            status: 'BOOKED',
            bookedOnline: false,
            startsAt: startsAt.toString(),
            patientNote: null,
            cancelReason: null,
            limitOverrideReason: null,
          },
          // Named as the patient's own view names them: only with a public profile (BR-24).
          { id: otherId, providerName: null },
        ],
      });
      expect(await auditCount('patient.export', id)).toBe(1);
      expect(await auditCount('appointment.export', appointmentId)).toBe(1);
      expect(await auditCount('appointment.export', otherId)).toBe(1);
      await world
        .send(request(world.server()).get(desk(practice, `patients/${randomUUID()}/export`)), admin)
        .expect(404);
    });
  });
});

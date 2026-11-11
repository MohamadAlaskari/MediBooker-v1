/**
 * What the team sets up on real databases (08 M02): the services, the opening hours and the special
 * days, who may change them, and that the public page shows a change on its next request.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, stepOf } from '../../src/modules/auth/domain/totp.js';
import { StaffRoles } from '../../src/modules/staff/staff-roles.js';
import { API, type Fixture, type Person, useBookingWorld } from './appointments/booking-world.js';

type Role = 'STAFF' | 'DOCTOR' | 'ADMIN';

interface PublicPage {
  services: { id: string; name: string | null }[];
  openingHours: { weekday: number; opensAt: string; closesAt: string }[];
  specialDays: { date: string; closed: boolean; label: string | null }[];
}

describe('what the team sets up, on real databases (08 M02)', () => {
  const world = useBookingWorld({ PRACTICE_SLUG: 'al-noor' });
  const team = new Map<Role, Person>();

  const member = async (role: Role): Promise<Person> => {
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
  const as = (role: Role): Person => {
    const person = team.get(role);
    if (person === undefined) throw new Error(`no ${role} in this world`);
    return person;
  };
  const path = (fixture: Fixture, rest: string): string =>
    `${API}/practices/${fixture.practice.practiceId}/${rest}`;
  const publicPage = async (): Promise<PublicPage> => {
    const answer = await request(world.server())
      .get(`${API}/public/practices/al-noor`)
      .set('Accept-Language', 'en')
      .expect(200);
    return answer.body as PublicPage;
  };
  const auditCount = (action: string, subjectId: string): Promise<number> =>
    world.asOwner(world.alNoor(), async (owner) => {
      const { rows } = await owner.query<{ count: string }>(
        'SELECT count(*) FROM audit_events WHERE action = $1 AND subject_id = $2',
        [action, subjectId],
      );
      return Number(rows[0]?.count ?? 0);
    });
  const fieldErrorsOf = (body: unknown): { field: string; code: string }[] =>
    (body as { errors: { field: string; code: string }[] }).errors.map(({ field, code }) => ({
      field,
      code,
    }));

  beforeAll(async () => {
    for (const role of ['STAFF', 'DOCTOR', 'ADMIN'] as const) team.set(role, await member(role));
  });

  describe('who may do what', () => {
    it('lets the admin manage services, the reception and the admin the hours, and the team read', async () => {
      const practice = world.alNoor();
      const service = { name: { ar: 'فحص تجريبي', en: 'Trial check' }, durationMinutes: 20 };
      const day = { date: '2026-12-01', closed: true };
      const week = { intervals: [{ weekday: 7, opensAt: '08:00', closesAt: '16:00' }] };
      const send = (role: Role, test: request.Test): request.Test => world.send(test, as(role));
      const server = (): ReturnType<typeof request> => request(world.server());

      for (const role of ['STAFF', 'DOCTOR'] as const) {
        const refused = await send(role, server().post(path(practice, 'services')))
          .send(service)
          .expect(403);
        expect(refused.body).toMatchObject({ code: 'FORBIDDEN' });
        await send(role, server().patch(path(practice, `services/${practice.serviceId}`)))
          .send({ durationMinutes: 25 })
          .expect(403);
      }
      await send('DOCTOR', server().put(path(practice, 'opening-hours')))
        .send(week)
        .expect(403);
      await send('DOCTOR', server().post(path(practice, 'special-days')))
        .send(day)
        .expect(403);
      const created = await send('STAFF', server().post(path(practice, 'special-days')))
        .send(day)
        .expect(201);
      const { id } = created.body as { id: string };
      await send('DOCTOR', server().delete(path(practice, `special-days/${id}`))).expect(403);
      await send('STAFF', server().delete(path(practice, `special-days/${id}`))).expect(204);
      await send('ADMIN', server().post(path(practice, 'services')))
        .send(service)
        .expect(201);
      for (const role of ['STAFF', 'DOCTOR', 'ADMIN'] as const) {
        await send(role, server().get(path(practice, 'services'))).expect(200);
        await send(role, server().get(path(practice, 'opening-hours'))).expect(200);
        await send(role, server().get(path(practice, 'special-days'))).expect(200);
      }
    });

    it('asks a patient for the second factor, and answers 404 in another practice', async () => {
      const practice = world.alNoor();
      const patient = await world.patient(practice);
      const refused = await world
        .send(request(world.server()).get(path(practice, 'services')), patient)
        .expect(403);
      expect(refused.body).toMatchObject({ code: 'MFA_REQUIRED' });
      await world
        .send(request(world.server()).get(path(world.lindenhof(), 'services')), as('ADMIN'))
        .expect(404);
      await world
        .send(
          request(world.server())
            .put(path(world.lindenhof(), 'opening-hours'))
            .send({ intervals: [] }),
          as('STAFF'),
        )
        .expect(404);
    });
  });

  describe('the services', () => {
    it('adds a service, which the public page shows at once and hides when it goes offline or is archived', async () => {
      const practice = world.alNoor();
      const added = await world
        .send(request(world.server()).post(path(practice, 'services')), as('ADMIN'))
        .send({
          name: { ar: ' تحليل دم ', en: 'Blood test' },
          description: { en: 'Please come fasting.\nWater is allowed.' },
          durationMinutes: 10,
          bufferMinutes: 5,
          referralRequired: true,
          allowedInsuranceTypes: ['SELF_PAY', 'SELF_PAY'],
        })
        .expect(201);
      const service = added.body as { id: string };
      expect(added.body).toMatchObject({
        name: { ar: 'تحليل دم', en: 'Blood test' },
        description: { en: 'Please come fasting.\nWater is allowed.' },
        durationMinutes: 10,
        bufferMinutes: 5,
        referralRequired: true,
        isBookableOnline: true,
        allowedInsuranceTypes: ['SELF_PAY'],
        active: true,
        providers: [],
      });
      expect(await auditCount('service.create', service.id)).toBe(1);
      expect((await publicPage()).services).toContainEqual(
        // Patients learn before they book that they bring a referral (BR-26); the buffer is not theirs.
        {
          id: service.id,
          name: 'Blood test',
          description: 'Please come fasting.\nWater is allowed.',
          durationMinutes: 10,
          referralRequired: true,
        },
      );

      const patch = (body: object): request.Test =>
        world
          .send(
            request(world.server()).patch(path(practice, `services/${service.id}`)),
            as('ADMIN'),
          )
          .send(body);
      await patch({ isBookableOnline: false }).expect(200);
      expect((await publicPage()).services.map(({ id }) => id)).not.toContain(service.id);
      await patch({ isBookableOnline: true, active: false }).expect(200, {
        ...(added.body as object),
        active: false,
      });
      expect((await publicPage()).services.map(({ id }) => id)).not.toContain(service.id);
      expect(await auditCount('service.update', service.id)).toBe(2);

      // The list has the archived one too, and the doctors whose working hours offer a service.
      const list = await world
        .send(request(world.server()).get(path(practice, 'services')), as('STAFF'))
        .expect(200);
      const body = list.body as {
        services: { id: string; active: boolean; providers: { id: string }[] }[];
        locales: string[];
      };
      expect(body.locales).toEqual(['ar', 'en']);
      expect(body.services.find(({ id }) => id === service.id)?.active).toBe(false);
      expect(
        body.services.find(({ id }) => id === practice.serviceId)?.providers.map(({ id }) => id),
      ).toEqual(expect.arrayContaining([practice.providerId, practice.otherProviderId]));
    });

    it('asks a name in every language, and refuses what the practice does not take', async () => {
      const practice = world.alNoor();
      const refused = await world
        .send(request(world.server()).post(path(practice, 'services')), as('ADMIN'))
        .send({
          name: { en: 'Check-up', de: 'Kontrolle' },
          description: { ar: 'x'.repeat(501) },
          durationMinutes: 4,
          bufferMinutes: 121,
        })
        .expect(400);
      expect(fieldErrorsOf(refused.body)).toEqual([
        { field: 'durationMinutes', code: 'TOO_SMALL' },
        { field: 'bufferMinutes', code: 'TOO_LARGE' },
      ]);
      const texts = await world
        .send(request(world.server()).post(path(practice, 'services')), as('ADMIN'))
        .send({
          name: { en: 'Check-up', de: 'Kontrolle' },
          description: { ar: 'x'.repeat(501) },
          durationMinutes: 30,
        })
        .expect(400);
      expect(fieldErrorsOf(texts.body)).toEqual([
        { field: 'name.de', code: 'UNKNOWN_FIELD' },
        { field: 'name.ar', code: 'REQUIRED' },
        { field: 'description.ar', code: 'TOO_LONG' },
      ]);
      await world
        .send(
          request(world.server()).patch(path(practice, `services/${randomUUID()}`)),
          as('ADMIN'),
        )
        .send({ active: false })
        .expect(404);
      await world
        .send(request(world.server()).patch(path(practice, 'services/not-a-uuid')), as('ADMIN'))
        .send({ active: false })
        .expect(404);
    });
  });

  describe('the opening hours', () => {
    it('names the interval that overlaps, from the database, and changes nothing', async () => {
      const practice = world.alNoor();
      const before = await world
        .send(request(world.server()).get(path(practice, 'opening-hours')), as('STAFF'))
        .expect(200);
      const refused = await world
        .send(request(world.server()).put(path(practice, 'opening-hours')), as('STAFF'))
        .send({
          intervals: [
            { weekday: 1, opensAt: '08:00', closesAt: '12:00' },
            { weekday: 2, opensAt: '08:00', closesAt: '12:00' },
            { weekday: 1, opensAt: '11:30', closesAt: '16:00' },
          ],
        })
        .expect(400);
      expect(refused.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(fieldErrorsOf(refused.body)).toEqual([
        { field: 'intervals[2]', code: 'OVERLAPS_EXISTING' },
      ]);
      const after = await world
        .send(request(world.server()).get(path(practice, 'opening-hours')), as('STAFF'))
        .expect(200);
      expect(after.body).toEqual(before.body);
    });

    it('replaces the week, which the public page shows on its next request', async () => {
      const practice = world.alNoor();
      const replaced = await world
        .send(request(world.server()).put(path(practice, 'opening-hours')), as('ADMIN'))
        .send({
          intervals: [
            { weekday: 4, opensAt: '16:00', closesAt: '24:00' },
            { weekday: 4, opensAt: '08:00', closesAt: '12:00' },
            { weekday: 7, opensAt: '08:00', closesAt: '16:00' },
          ],
        })
        .expect(200);
      expect(replaced.body).toMatchObject({
        intervals: [
          { weekday: 4, opensAt: '08:00', closesAt: '12:00' },
          { weekday: 4, opensAt: '16:00', closesAt: '24:00' },
          { weekday: 7, opensAt: '08:00', closesAt: '16:00' },
        ],
      });
      expect((await publicPage()).openingHours).toEqual(
        (replaced.body as { intervals: object[] }).intervals,
      );
      expect(await auditCount('opening_hours.replace', practice.practice.practiceId)).toBe(1);
      const backwards = await world
        .send(request(world.server()).put(path(practice, 'opening-hours')), as('ADMIN'))
        .send({ intervals: [{ weekday: 1, opensAt: '12:00', closesAt: '08:00' }] })
        .expect(400);
      expect(fieldErrorsOf(backwards.body)).toEqual([
        { field: 'intervals[0].closesAt', code: 'TOO_SMALL' },
      ]);
    });
  });

  describe('the special days', () => {
    it('adds a closed day and a day with other hours, once per date, and removes one', async () => {
      const practice = world.alNoor();
      const post = (body: object): request.Test =>
        world
          .send(request(world.server()).post(path(practice, 'special-days')), as('STAFF'))
          .send(body);
      const training = await post({
        date: '2026-11-23',
        closed: true,
        label: { ar: 'تدريب الفريق', en: 'Team training' },
      }).expect(201);
      expect(training.body).toMatchObject({
        date: '2026-11-23',
        closed: true,
        opensAt: null,
        closesAt: null,
        label: { ar: 'تدريب الفريق', en: 'Team training' },
      });
      const { id } = training.body as { id: string };
      expect(await auditCount('special_day.create', id)).toBe(1);
      await post({ date: '2026-11-26', closed: false, opensAt: '09:00', closesAt: '13:00' }).expect(
        201,
      );
      const again = await post({ date: '2026-11-23', closed: true }).expect(400);
      expect(fieldErrorsOf(again.body)).toEqual([{ field: 'date', code: 'ALREADY_EXISTS' }]);
      const past = await post({ date: '2026-11-14', closed: false, opensAt: '09:00' }).expect(400);
      expect(fieldErrorsOf(past.body)).toEqual([
        { field: 'date', code: 'TOO_SMALL' },
        { field: 'closesAt', code: 'REQUIRED' },
      ]);
      const noDay = await post({ date: '2026-02-30', closed: true }).expect(400);
      expect(fieldErrorsOf(noDay.body)).toEqual([{ field: 'date', code: 'INVALID_VALUE' }]);

      const list = await world
        .send(request(world.server()).get(path(practice, 'special-days')), as('DOCTOR'))
        .expect(200);
      expect(list.body).toMatchObject({ today: '2026-11-15', locales: ['ar', 'en'] });
      const dates = (list.body as { specialDays: { date: string }[] }).specialDays.map(
        ({ date }) => date,
      );
      expect(dates).toEqual(expect.arrayContaining(['2026-11-23', '2026-11-26']));
      expect((await publicPage()).specialDays).toContainEqual({
        date: '2026-11-23',
        closed: true,
        opensAt: null,
        closesAt: null,
        label: 'Team training',
      });

      const remove = (): request.Test =>
        world.send(
          request(world.server()).delete(path(practice, `special-days/${id}`)),
          as('ADMIN'),
        );
      await remove().expect(204);
      await remove().expect(404);
      expect(await auditCount('special_day.delete', id)).toBe(1);
      expect((await publicPage()).specialDays.map(({ date }) => date)).not.toContain('2026-11-23');
    });
  });
});

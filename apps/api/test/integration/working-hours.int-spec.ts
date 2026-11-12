/**
 * The doctors' schedules on real databases (08 M04, W14): working hours, absences, the free times
 * made from them, a time blocked or freed, and who may plan which doctor.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, stepOf } from '../../src/modules/auth/domain/totp.js';
import { StaffRoles } from '../../src/modules/staff/staff-roles.js';
import { API, type Person, useBookingWorld } from './appointments/booking-world.js';

type Role = 'STAFF' | 'DOCTOR' | 'ADMIN';
type Method = 'get' | 'put' | 'post' | 'patch' | 'delete';

/** Monday 16 November 2026, 09:00 and 09:30 in Riyadh; the clock stands on Sunday at 10:00. */
const MONDAY_9 = Temporal.Instant.from('2026-11-16T06:00:00Z');
const MONDAY_930 = Temporal.Instant.from('2026-11-16T06:30:00Z');
/** Tuesday 17 November 2026, 09:00 in Riyadh. */
const TUESDAY_9 = Temporal.Instant.from('2026-11-17T06:00:00Z');
const RIYADH = 'Asia/Riyadh';

describe('the doctors’ schedules on real databases (08 M04)', () => {
  const world = useBookingWorld({ PRACTICE_SLUG: 'al-noor' });
  const team = new Map<string, Person>();

  const member = async (role: Role, providerId?: string): Promise<Person> => {
    const who = await world.person();
    await world.app().get(StaffRoles).setRole(who.email, role, 'local:test', providerId);
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
  const as = (name: string): Person => {
    const person = team.get(name);
    if (person === undefined) throw new Error(`no ${name} in this world`);
    return person;
  };
  const call = (method: Method, rest: string, who: Person): request.Test =>
    world.send(
      request(world.server())[method](
        `${API}/practices/${world.alNoor().practice.practiceId}/${rest}`,
      ),
      who,
    );
  const slotAt = (providerId: string, startsAt: Temporal.Instant) =>
    world.asOwner(world.alNoor(), async (owner) => {
      const { rows } = await owner.query<{ id: string; status: string }>(
        'SELECT id, status::text AS status FROM slots WHERE provider_id = $1 AND starts_at = $2',
        [providerId, startsAt.toString()],
      );
      return rows[0];
    });
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
  const publicTimes = async (date: string): Promise<string[]> => {
    const answer = await world
      .freeTimes(await world.person(), world.alNoor(), {
        serviceId: world.alNoor().serviceId,
        providerId: world.alNoor().providerId,
        date,
      })
      .expect(200);
    return (answer.body as { times: { startsAt: string }[] }).times.map(({ startsAt }) =>
      Temporal.Instant.from(startsAt).toString(),
    );
  };

  beforeAll(async () => {
    const { providerId } = world.alNoor();
    team.set('staff', await member('STAFF'));
    team.set('admin', await member('ADMIN'));
    team.set('doctor', await member('DOCTOR', providerId));
    team.set('unlinked', await member('DOCTOR'));
  });

  it('makes the free times from the rules, and a second time adds nothing', async () => {
    const first = await call('post', 'slots/generate', as('staff')).expect(201);
    expect((first.body as { created: number }).created).toBeGreaterThan(0);
    const second = await call('post', 'slots/generate', as('admin')).expect(201);
    expect(second.body).toEqual({ created: 0, removed: 0 });
    // A doctor plans itself, not the practice's times.
    await call('post', 'slots/generate', as('doctor')).expect(403);
    expect(await auditCount('slots.generate', world.alNoor().practice.practiceId)).toBe(2);
  });

  it('lets a doctor plan only itself, and nobody a doctor that is none', async () => {
    const { providerId, otherProviderId } = world.alNoor();
    const week = {
      slotMinutes: 30,
      intervals: [{ weekday: 1, startsAt: '09:00', endsAt: '10:00' }],
      serviceIds: [world.alNoor().serviceId],
    };
    await call('get', `providers/${providerId}/working-hours`, as('doctor')).expect(200);
    await call('get', `providers/${otherProviderId}/working-hours`, as('doctor')).expect(404);
    await call('put', `providers/${otherProviderId}/working-hours`, as('doctor'))
      .send(week)
      .expect(404);
    await call('get', `providers/${otherProviderId}/absences`, as('doctor')).expect(404);
    // A doctor's account that names no doctor yet plans nobody (M03 links them).
    await call('get', `providers/${providerId}/working-hours`, as('unlinked')).expect(404);
    await call('get', `providers/${randomUUID()}/working-hours`, as('staff')).expect(404);
    await call('get', 'providers/not-a-uuid/working-hours', as('staff')).expect(404);
    const membership = await call('get', 'me/membership', as('doctor')).expect(200);
    expect(membership.body).toEqual({ role: 'DOCTOR', providerId });

    const patient = await world.patient(world.alNoor());
    const refused = await world
      .send(
        request(world.server()).get(
          `${API}/practices/${world.alNoor().practice.practiceId}/providers/${providerId}/working-hours`,
        ),
        patient,
      )
      .expect(403);
    expect(refused.body).toMatchObject({ code: 'MFA_REQUIRED' });
    await world
      .send(
        request(world.server()).get(
          `${API}/practices/${world.lindenhof().practice.practiceId}/providers/${providerId}/working-hours`,
        ),
        as('staff'),
      )
      .expect(404);
  });

  it('shows a doctor’s week with its services and free times', async () => {
    const { providerId, serviceId } = world.alNoor();
    const answer = await call('get', `providers/${providerId}/working-hours`, as('staff')).expect(
      200,
    );
    expect(answer.body).toMatchObject({
      providerId,
      slotMinutes: 30,
      timeZone: RIYADH,
      weekStart: 7,
      today: '2026-11-15',
    });
    const body = answer.body as {
      intervals: { weekday: number; startsAt: string; endsAt: string }[];
      serviceIds: string[];
      booking: { freeTimes: number; openUntil: string | null };
    };
    expect(body.intervals).toContainEqual({ weekday: 7, startsAt: '09:00', endsAt: '13:00' });
    expect(body.intervals).toContainEqual({ weekday: 7, startsAt: '16:00', endsAt: '20:00' });
    expect(body.serviceIds).toContain(serviceId);
    expect(body.booking.freeTimes).toBeGreaterThan(0);
    expect(body.booking.openUntil).not.toBeNull();
  });

  it('blocks a free time, which nobody can book then, and refuses a time an appointment holds', async () => {
    const { providerId, otherProviderId, serviceId } = world.alNoor();
    const free = await slotAt(providerId, MONDAY_9);
    if (free === undefined) throw new Error('no time on Monday at 09:00');
    expect(await publicTimes('2026-11-16')).toContain(MONDAY_9.toString());
    const blocked = await call('patch', `slots/${free.id}`, as('doctor'))
      .send({ status: 'BLOCKED' })
      .expect(200);
    expect(blocked.body).toMatchObject({ id: free.id, status: 'BLOCKED', providerId });
    // A retry answers alike and writes nothing.
    await call('patch', `slots/${free.id}`, as('doctor')).send({ status: 'BLOCKED' }).expect(200);
    expect(await auditCount('slot.block', free.id)).toBe(1);
    expect(await publicTimes('2026-11-16')).not.toContain(MONDAY_9.toString());
    await call('patch', `slots/${free.id}`, as('staff')).send({ status: 'OPEN' }).expect(200);
    expect(await publicTimes('2026-11-16')).toContain(MONDAY_9.toString());

    const others = await slotAt(otherProviderId, MONDAY_9);
    if (others === undefined) throw new Error('no time of the other doctor on Monday at 09:00');
    await call('patch', `slots/${others.id}`, as('doctor')).send({ status: 'BLOCKED' }).expect(404);
    await call('patch', `slots/${randomUUID()}`, as('staff'))
      .send({ status: 'BLOCKED' })
      .expect(404);

    const patient = await world.patient(world.alNoor());
    await world
      .book(patient, world.alNoor(), {
        serviceId,
        startsAt: MONDAY_930.toString(),
        providerId,
      })
      .expect(201);
    const held = await slotAt(providerId, MONDAY_930);
    expect(held?.status).toBe('BOOKED');
    const refused = await call('patch', `slots/${held?.id ?? ''}`, as('staff'))
      .send({ status: 'BLOCKED' })
      .expect(409);
    expect(refused.body).toMatchObject({ code: 'SLOT_HAS_APPOINTMENT' });
  });

  it('replaces a doctor’s week from today: a booked time stays, the free ones follow the new rules', async () => {
    const { otherProviderId, serviceId, practice } = world.alNoor();
    const patientId = await world.join(await world.person(), world.alNoor());
    await call('post', 'desk/appointments', as('staff'))
      .set('Idempotency-Key', randomUUID())
      .send({ patientId, serviceId, startsAt: TUESDAY_9.toString(), providerId: otherProviderId })
      .expect(201);
    const replaced = await call('put', `providers/${otherProviderId}/working-hours`, as('staff'))
      .send({
        slotMinutes: 20,
        intervals: [{ weekday: 3, startsAt: '08:00', endsAt: '09:00' }],
        serviceIds: [serviceId, serviceId],
      })
      .expect(200);
    expect(replaced.body).toMatchObject({
      slotMinutes: 20,
      intervals: [{ weekday: 3, startsAt: '08:00', endsAt: '09:00' }],
      serviceIds: [serviceId],
    });
    expect((replaced.body as { booking: { freeTimes: number } }).booking.freeTimes).toBeGreaterThan(
      0,
    );
    expect(await auditCount('working_hours.replace', otherProviderId)).toBe(1);

    const rows = await world.asOwner(world.alNoor(), async (owner) => {
      const { rows: found } = await owner.query<{
        starts_at: Date;
        status: string;
        rule_id: string | null;
      }>(
        `SELECT starts_at, status::text AS status, rule_id FROM slots
         WHERE provider_id = $1 AND starts_at > $2 ORDER BY starts_at`,
        [otherProviderId, world.clock.now().toString()],
      );
      return found;
    });
    const at = (row: { starts_at: Date }) =>
      Temporal.Instant.fromEpochMilliseconds(row.starts_at.getTime()).toZonedDateTimeISO(RIYADH);
    expect(rows.find((row) => at(row).toInstant().equals(TUESDAY_9))?.status).toBe('BOOKED');
    const free = rows.filter(({ status, rule_id }) => status === 'OPEN' && rule_id !== null);
    expect(free.length).toBeGreaterThan(0);
    for (const row of free) {
      const local = at(row);
      expect(local.dayOfWeek).toBe(3);
      expect([480, 500, 520]).toContain(local.hour * 60 + local.minute);
    }
    // The rules of before end yesterday; the new one starts today.
    const validity = await world.asOwner(world.alNoor(), async (owner) => {
      const { rows: found } = await owner.query<{ valid_from: string; valid_to: string | null }>(
        `SELECT valid_from::text, valid_to::text FROM availability_rules WHERE provider_id = $1`,
        [otherProviderId],
      );
      return found;
    });
    expect(validity.filter(({ valid_to }) => valid_to === '2026-11-14').length).toBeGreaterThan(0);
    expect(validity).toContainEqual({ valid_from: '2026-11-15', valid_to: null });
    expect(practice.practiceId).toBeDefined();

    const overlap = await call('put', `providers/${otherProviderId}/working-hours`, as('staff'))
      .send({
        slotMinutes: 30,
        intervals: [
          { weekday: 1, startsAt: '08:00', endsAt: '12:00' },
          { weekday: 1, startsAt: '11:00', endsAt: '13:00' },
        ],
        serviceIds: [serviceId],
      })
      .expect(400);
    expect(fieldErrorsOf(overlap.body)).toEqual([
      { field: 'intervals[1]', code: 'OVERLAPS_EXISTING' },
    ]);
    const without = await call('put', `providers/${otherProviderId}/working-hours`, as('staff'))
      .send({
        slotMinutes: 30,
        intervals: [{ weekday: 1, startsAt: '08:00', endsAt: '12:00' }],
        serviceIds: [],
      })
      .expect(400);
    expect(fieldErrorsOf(without.body)).toEqual([{ field: 'serviceIds', code: 'REQUIRED' }]);
  });

  it('takes the free times of an absence, counts its booked appointments, and brings them back', async () => {
    const { providerId } = world.alNoor();
    const created = await call('post', `providers/${providerId}/absences`, as('doctor'))
      .send({ startDate: '2026-11-16', endDate: '2026-11-16', reason: 'TRAINING' })
      .expect(201);
    expect(created.body).toMatchObject({
      reason: 'TRAINING',
      allDay: true,
      bookedInside: 1,
      startsAt: '2026-11-15T21:00:00Z',
      endsAt: '2026-11-16T21:00:00Z',
    });
    const { id } = created.body as { id: string };
    expect(await publicTimes('2026-11-16')).toEqual([]);
    expect((await slotAt(providerId, MONDAY_930))?.status).toBe('BOOKED');
    const list = await call('get', `providers/${providerId}/absences`, as('staff')).expect(200);
    expect((list.body as { absences: { id: string }[] }).absences.map((a) => a.id)).toContain(id);
    expect(await auditCount('absence.create', id)).toBe(1);

    const past = await call('post', `providers/${providerId}/absences`, as('staff'))
      .send({ startDate: '2026-11-10', endDate: '2026-11-12', reason: 'VACATION' })
      .expect(400);
    expect(fieldErrorsOf(past.body)).toEqual([{ field: 'endDate', code: 'TOO_SMALL' }]);

    await call('delete', `providers/${providerId}/absences/${id}`, as('staff')).expect(204);
    await call('delete', `providers/${providerId}/absences/${id}`, as('staff')).expect(404);
    expect(await publicTimes('2026-11-16')).toContain(MONDAY_9.toString());
  });

  it('names the doctors who offer a service, through their working hours', async () => {
    const { providerId, otherProviderId, serviceId } = world.alNoor();
    const one = await call('put', `services/${serviceId}/providers`, as('admin'))
      .send({ providerIds: [providerId] })
      .expect(200);
    expect((one.body as { providers: { id: string }[] }).providers.map(({ id }) => id)).toEqual([
      providerId,
    ]);
    const both = await call('put', `services/${serviceId}/providers`, as('admin'))
      .send({ providerIds: [providerId, otherProviderId] })
      .expect(200);
    expect(
      (both.body as { providers: { id: string }[] }).providers.map(({ id }) => id).toSorted(),
    ).toEqual([providerId, otherProviderId].toSorted());
    const list = await call('get', 'services', as('staff')).expect(200);
    expect((list.body as { doctors: object[] }).doctors).toContainEqual(
      expect.objectContaining({ id: providerId, hasWorkingHours: true }),
    );
    await call('put', `services/${serviceId}/providers`, as('staff'))
      .send({ providerIds: [providerId] })
      .expect(403);
    const nobody = await call('put', `services/${serviceId}/providers`, as('admin'))
      .send({ providerIds: [randomUUID()] })
      .expect(400);
    expect(fieldErrorsOf(nobody.body)).toEqual([
      { field: 'providerIds[0]', code: 'INVALID_VALUE' },
    ]);
  });

  it('keeps a doctor out of another doctor’s absences, also under its own path', async () => {
    const { providerId, otherProviderId } = world.alNoor();
    const day = { startDate: '2026-12-21', endDate: '2026-12-21', reason: 'TRAINING' };
    await call('post', `providers/${otherProviderId}/absences`, as('doctor')).send(day).expect(404);
    const created = await call('post', `providers/${otherProviderId}/absences`, as('staff'))
      .send(day)
      .expect(201);
    const { id } = created.body as { id: string };
    await call('delete', `providers/${otherProviderId}/absences/${id}`, as('doctor')).expect(404);
    // The doctor's own path names an absence that is another doctor's: there is none for it.
    await call('delete', `providers/${providerId}/absences/${id}`, as('doctor')).expect(404);
    expect(await auditCount('absence.delete', id)).toBe(0);
    await call('delete', `providers/${otherProviderId}/absences/${id}`, as('staff')).expect(204);
    expect(await auditCount('absence.delete', id)).toBe(1);
  });

  it('never leaves a free time inside an absence that comes while the free times are made', async () => {
    const { providerId } = world.alNoor();
    // Monday 23 November 2026, a working day of the doctor.
    expect((await publicTimes('2026-11-23')).length).toBeGreaterThan(0);
    const [, created] = await Promise.all([
      call('post', 'slots/generate', as('admin')).expect(201),
      call('post', `providers/${providerId}/absences`, as('staff'))
        .send({ startDate: '2026-11-23', endDate: '2026-11-23', reason: 'OTHER' })
        .expect(201),
    ]);
    expect(await publicTimes('2026-11-23')).toEqual([]);
    const { id } = created.body as { id: string };
    await call('delete', `providers/${providerId}/absences/${id}`, as('staff')).expect(204);
    expect((await publicTimes('2026-11-23')).length).toBeGreaterThan(0);
  });

  it('links an account to its doctor only as a doctor and only once, and audits the link', async () => {
    const { providerId, otherProviderId } = world.alNoor();
    const roles = world.app().get(StaffRoles);
    const first = await world.person();
    const second = await world.person();
    expect(await roles.setRole(first.email, 'STAFF', 'local:test', otherProviderId)).toEqual({
      result: 'LINK_NEEDS_DOCTOR_ROLE',
    });
    // The seeded doctor is the account of beforeAll already.
    expect(await roles.setRole(first.email, 'DOCTOR', 'local:test', providerId)).toEqual({
      result: 'DOCTOR_ALREADY_LINKED',
    });
    expect(await auditCount('staff.provider.link', providerId)).toBe(1);
    expect(await roles.setRole(first.email, 'DOCTOR', 'local:test', otherProviderId)).toMatchObject(
      { result: 'SET' },
    );
    expect(await roles.setRole(second.email, 'DOCTOR', 'local:test', otherProviderId)).toEqual({
      result: 'DOCTOR_ALREADY_LINKED',
    });
    // Another role drops the link, and the doctor can be another account.
    expect(await roles.setRole(first.email, 'STAFF', 'local:test')).toMatchObject({
      result: 'SET',
    });
    expect(
      await roles.setRole(second.email, 'DOCTOR', 'local:test', otherProviderId),
    ).toMatchObject({ result: 'SET' });
    expect(await auditCount('staff.provider.link', otherProviderId)).toBe(2);
  });
});

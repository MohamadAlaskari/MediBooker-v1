/**
 * The practice's desk on real databases (08 M05): the team's day, one appointment with what the
 * patient wrote, the changes of BR-04 and BR-11 with their status-transition matrix at the edges,
 * the audit of every read and change, and who may reach it.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { base32Decode, hotp, stepOf } from '../../../src/modules/auth/domain/totp.js';
import { StaffRoles } from '../../../src/modules/staff/staff-roles.js';
import { API, type Fixture, NOW, type Person, useBookingWorld } from './booking-world.js';
import { placeOf, type TeamRole } from '../support/team-roles.js';

const SLUG = 'al-noor';
const NOTE = 'Synthetic note: please bring the old results.';
const REASON = 'Synthetic reason: the doctor is away that day.';

type Role = TeamRole;

interface Row {
  id: string;
  status: string;
  day: string;
  started: boolean;
  actions: string[];
  checkedInAt: string | null;
  completedAt: string | null;
  cancelledByPractice: boolean;
  bookedOnline: boolean;
  providerName: string;
  patient: { firstName: string; lastName: string; insuranceType: string };
}

interface Day {
  date: string;
  today: string;
  counts: { booked: number; checkedIn: number; cancelled: number };
  openTimes: number;
  nextOpenAt: string | null;
  items: Row[];
  truncated: boolean;
}

describe('the practice desk on real databases (08 M05)', () => {
  const world = useBookingWorld({ PRACTICE_SLUG: SLUG });

  const desk = (fixture: Fixture): string => `${API}/practices/${fixture.practice.practiceId}/desk`;

  /** A member of the team with this role, signed in with both factors (A04). */
  const member = async (role: Role = 'STAFF'): Promise<Person & { refreshToken: string }> => {
    const who = await world.person();
    const place = placeOf(role);
    await world
      .app()
      .get(StaffRoles)
      .setRole(who.email, place.role, 'local:test', { managesPractice: place.managesPractice });
    const start = await world
      .send(request(world.server()).post(`${API}/me/mfa/totp`), who)
      .expect(200);
    const { secret } = start.body as { secret: string };
    const confirmed = await world
      .send(request(world.server()).post(`${API}/me/mfa/totp/confirm`), who)
      .send({ code: hotp(base32Decode(secret), stepOf(world.clock.now())) })
      .expect(200);
    const { tokens } = confirmed.body as { tokens: { accessToken: string; refreshToken: string } };
    return { ...who, token: tokens.accessToken, refreshToken: tokens.refreshToken };
  };

  /** A refresh as the app sends it, with the token in the body. */
  const refresh = (refreshToken: string): request.Test =>
    world
      .send(request(world.server()).post(`${API}/auth/refresh`), undefined)
      .send({ refreshToken });

  const day = (who: Person, fixture: Fixture, date?: string): request.Test =>
    world.send(
      request(world.server()).get(
        `${desk(fixture)}/day${date === undefined ? '' : `?date=${date}`}`,
      ),
      who,
    );
  const details = (who: Person, fixture: Fixture, id: string): request.Test =>
    world.send(request(world.server()).get(`${desk(fixture)}/appointments/${id}`), who);
  const act = (
    who: Person,
    fixture: Fixture,
    id: string,
    action: 'check-in' | 'complete' | 'no-show',
  ): request.Test =>
    world.send(request(world.server()).post(`${desk(fixture)}/appointments/${id}/${action}`), who);
  const cancel = (who: Person, fixture: Fixture, id: string, body?: object): request.Test => {
    const test = world.send(
      request(world.server()).post(`${desk(fixture)}/appointments/${id}/cancel`),
      who,
    );
    return body === undefined ? test : test.send(body);
  };

  /** A patient's booking at this time, with a note when given; its id. */
  const booked = async (
    fixture: Fixture,
    startsAt: Temporal.Instant,
    patientNote?: string,
  ): Promise<{ readonly id: string; readonly patient: Person }> => {
    const patient = await world.patient(fixture);
    const response = await world
      .book(patient, fixture, {
        serviceId: fixture.serviceId,
        startsAt: startsAt.toString(),
        ...(patientNote === undefined ? {} : { patientNote }),
      })
      .expect(201);
    return { id: (response.body as { id: string }).id, patient };
  };

  /** A booking later today, in the booking window. */
  const bookedToday = async (fixture: Fixture, patientNote?: string) =>
    booked(fixture, await world.freshSlot(fixture), patientNote);

  const auditCount = (fixture: Fixture, action: string, subjectId: string): Promise<number> =>
    world.asOwner(fixture, async (owner) => {
      const { rows } = await owner.query<{ count: string }>(
        'SELECT count(*) FROM audit_events WHERE action = $1 AND subject_id = $2',
        [action, subjectId],
      );
      return Number(rows[0]?.count ?? 0);
    });

  const slotStatus = (fixture: Fixture, appointmentId: string): Promise<string | undefined> =>
    world.asOwner(fixture, async (owner) => {
      const { rows } = await owner.query<{ status: string }>(
        'SELECT s.status FROM appointments a JOIN slots s ON s.id = a.slot_id WHERE a.id = $1',
        [appointmentId],
      );
      return rows[0]?.status;
    });

  describe('the day of the team (W1)', () => {
    it('lists the appointments of today in the order of time, with what the team can do', async () => {
      const practice = world.alNoor();
      const team = await member();
      const first = await bookedToday(practice);
      const second = await bookedToday(practice, NOTE);
      const response = await day(team, practice).expect(200);
      const body = response.body as Day;
      expect(body).toMatchObject({ date: '2026-11-15', today: '2026-11-15', truncated: false });
      const ids = body.items.map(({ id }) => id);
      expect(ids.indexOf(first.id)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(second.id)).toBeGreaterThan(ids.indexOf(first.id));
      const row = body.items.find(({ id }) => id === second.id);
      expect(row).toMatchObject({
        status: 'BOOKED',
        day: 'TODAY',
        started: false,
        actions: ['CHECK_IN', 'CANCEL'],
        bookedOnline: true,
        cancelledByPractice: false,
        patient: { firstName: 'Sami', lastName: 'Beispiel', insuranceType: 'SELF_PAY' },
      });
      expect(row?.providerName).not.toBe('');
      // A list never carries what the patient wrote.
      expect(JSON.stringify(body)).not.toContain(NOTE);
      expect(body.counts.booked).toBeGreaterThanOrEqual(2);
      expect(body.openTimes).toBeGreaterThanOrEqual(0);
    });

    it('writes an audit event for each appointment a list shows, once in five minutes (BR-18)', async () => {
      const practice = world.alNoor();
      const team = await member();
      const { id } = await bookedToday(practice);
      await day(team, practice).expect(200);
      await day(team, practice).expect(200);
      expect(await auditCount(practice, 'appointment.list', id)).toBe(1);
      // Another member's read counts for that member.
      await day(await member(), practice).expect(200);
      expect(await auditCount(practice, 'appointment.list', id)).toBe(2);
      world.clock.set(NOW.add({ minutes: 6 }));
      await day(team, practice).expect(200);
      expect(await auditCount(practice, 'appointment.list', id)).toBe(3);
    });

    it('shows another day, and refuses a date that is none', async () => {
      const practice = world.alNoor();
      const team = await member();
      const startsAt = await world.changeableSlot(practice);
      const { id } = await booked(practice, startsAt);
      const date = startsAt.toZonedDateTimeISO('Asia/Riyadh').toPlainDate().toString();
      const other = (await day(team, practice, date).expect(200)).body as Day;
      expect(other).toMatchObject({ date, today: '2026-11-15' });
      expect(other.items.find((row) => row.id === id)).toMatchObject({
        day: 'FUTURE',
        actions: ['CANCEL'],
      });
      for (const wrong of ['2026-02-31', 'tomorrow', '2026-1-5']) {
        const refused = await day(team, practice, wrong).expect(400);
        expect(refused.body).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: [{ field: 'date' }],
        });
      }
    });
  });

  describe('one appointment (W6)', () => {
    it('shows what the patient wrote and how to reach them, and audits the read', async () => {
      const practice = world.alNoor();
      const team = await member('DOCTOR');
      const { id, patient } = await bookedToday(practice, NOTE);
      const response = await details(team, practice, id).expect(200);
      expect(response.body).toMatchObject({
        id,
        patientNote: NOTE,
        cancelReason: null,
        timeZone: 'Asia/Riyadh',
        patient: {
          firstName: 'Sami',
          dateOfBirth: '1990-04-12',
          age: 36,
          insuranceType: 'SELF_PAY',
          email: patient.email,
        },
      });
      expect(await auditCount(practice, 'appointment.read', id)).toBe(1);
    });

    it('answers 404 for an id that is not an appointment of this practice', async () => {
      const practice = world.alNoor();
      const team = await member();
      const elsewhere = await booked(world.lindenhof(), await world.freshSlot(world.lindenhof()));
      const refused = await details(team, practice, elsewhere.id).expect(404);
      expect(refused.body).toMatchObject({ code: 'NOT_FOUND' });
      await details(team, practice, '00000000-0000-4000-8000-000000000000').expect(404);
      await details(team, practice, 'not-an-id').expect(404);
      await act(team, practice, elsewhere.id, 'check-in').expect(404);
    });
  });

  describe('the changes of the team (BR-11)', () => {
    it('checks in and completes on the day; a retry answers alike and is audited once', async () => {
      const practice = world.alNoor();
      const team = await member();
      const { id } = await bookedToday(practice);
      const checkedIn = await act(team, practice, id, 'check-in').expect(200);
      expect(checkedIn.body).toMatchObject({
        id,
        status: 'CHECKED_IN',
        checkedInAt: NOW.toString(),
        actions: ['COMPLETE'],
      });
      const again = await act(team, practice, id, 'check-in').expect(200);
      expect(again.body).toEqual(checkedIn.body);
      // Within the access token's 15 minutes, which the API checks against the same clock.
      world.clock.set(NOW.add({ minutes: 10 }));
      const completed = await act(team, practice, id, 'complete').expect(200);
      expect(completed.body).toMatchObject({
        status: 'COMPLETED',
        checkedInAt: NOW.toString(),
        completedAt: NOW.add({ minutes: 10 }).toString(),
        actions: [],
      });
      expect(await auditCount(practice, 'appointment.check_in', id)).toBe(1);
      expect(await auditCount(practice, 'appointment.complete', id)).toBe(1);
      const late = await act(team, practice, id, 'no-show').expect(409);
      expect(late.body).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
      // A completed visit keeps its time.
      expect(await slotStatus(practice, id)).toBe('BOOKED');
    });

    it('records a no-show from the start on, not before (B03 acceptance)', async () => {
      const practice = world.alNoor();
      const team = await member();
      const startsAt = await world.freshSlot(practice);
      const { id } = await booked(practice, startsAt);
      const early = await act(team, practice, id, 'no-show').expect(409);
      expect(early.body).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
      world.clock.set(startsAt);
      // Signed in at the new time: an access token lasts 15 minutes of the same clock.
      const later = await member();
      const noShow = await act(later, practice, id, 'no-show').expect(200);
      expect(noShow.body).toMatchObject({ status: 'NO_SHOW', started: true, actions: [] });
      await act(later, practice, id, 'check-in').expect(409);
      await cancel(later, practice, id, { cancelReason: REASON }).expect(409);
      // The time stays taken: it is in the past of that patient.
      expect(await slotStatus(practice, id)).toBe('BOOKED');
    });

    it('changes nothing on another day than the appointment’s', async () => {
      const practice = world.alNoor();
      const team = await member();
      const startsAt = await world.changeableSlot(practice);
      const { id } = await booked(practice, startsAt);
      for (const action of ['check-in', 'complete', 'no-show'] as const) {
        const refused = await act(team, practice, id, action).expect(409);
        expect(refused.body).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
      }
      // The day after, it lies in the past.
      world.clock.set(startsAt.add({ hours: 24 }));
      const later = await member();
      await act(later, practice, id, 'check-in').expect(409);
      const view = await details(later, practice, id).expect(200);
      expect(view.body).toMatchObject({ day: 'PAST', status: 'BOOKED', actions: ['CANCEL'] });
    });
  });

  describe('a cancel by the practice (BR-04)', () => {
    it('needs a reason, keeps it for the team only, and frees the time', async () => {
      const practice = world.alNoor();
      const team = await member('MANAGER');
      const startsAt = await world.changeableSlot(practice);
      const { id, patient } = await booked(practice, startsAt);
      const missing = await cancel(team, practice, id).expect(400);
      expect(missing.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      const { errors } = missing.body as { errors: { field: string }[] };
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every(({ field }) => field === 'cancelReason')).toBe(true);
      await cancel(team, practice, id, { cancelReason: '   ' }).expect(400);
      await cancel(team, practice, id, { cancelReason: 'x'.repeat(501) }).expect(400);
      const cancelled = await cancel(team, practice, id, { cancelReason: REASON }).expect(200);
      expect(cancelled.body).toMatchObject({
        id,
        status: 'CANCELLED',
        cancelledByPractice: true,
        actions: [],
      });
      expect(JSON.stringify(cancelled.body)).not.toContain(REASON);
      expect(await slotStatus(practice, id)).toBe('OPEN');
      const view = await details(team, practice, id).expect(200);
      expect(view.body).toMatchObject({ cancelReason: REASON, cancelledByPractice: true });
      // Sealed in the database, and the patient sees the status, never the reason.
      const stored = await world.asOwner(practice, async (owner) => {
        const { rows } = await owner.query<{ cancel_reason_encrypted: string }>(
          'SELECT cancel_reason_encrypted FROM appointments WHERE id = $1',
          [id],
        );
        return rows[0]?.cancel_reason_encrypted ?? '';
      });
      expect(stored).not.toBe('');
      expect(stored).not.toContain('Synthetic');
      const own = await world
        .send(
          request(world.server()).get(
            `${API}/practices/${practice.practice.practiceId}/appointments/${id}`,
          ),
          patient,
        )
        .expect(200);
      expect(own.body).toMatchObject({ status: 'CANCELLED' });
      expect(JSON.stringify(own.body)).not.toContain(REASON);
      // A retry answers alike and keeps the first reason.
      const again = await cancel(team, practice, id, { cancelReason: 'Another reason' }).expect(
        200,
      );
      expect(again.body).toEqual(cancelled.body);
      expect(await auditCount(practice, 'appointment.cancel_by_practice', id)).toBe(1);
      const after = await details(team, practice, id).expect(200);
      expect(after.body).toMatchObject({ cancelReason: REASON });
    });

    it('cannot cancel a visit that has begun', async () => {
      const practice = world.alNoor();
      const team = await member();
      const { id } = await bookedToday(practice);
      await act(team, practice, id, 'check-in').expect(200);
      const refused = await cancel(team, practice, id, { cancelReason: REASON }).expect(409);
      expect(refused.body).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    });
  });

  describe('a cancel that the patient made first', () => {
    it('is refused for an appointment the patient moved, so that nobody is told wrongly', async () => {
      const practice = world.alNoor();
      const team = await member();
      const { id, patient } = await booked(practice, await world.changeableSlot(practice));
      const later = await world.changeableSlot(practice);
      const moved = await world
        .reschedule(patient, practice, id, { startsAt: later.toString() })
        .expect(201);
      const refused = await cancel(team, practice, id, { cancelReason: REASON }).expect(409);
      expect(refused.body).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
      const kept = await details(team, practice, (moved.body as { id: string }).id).expect(200);
      expect(kept.body).toMatchObject({ status: 'BOOKED', cancelledByPractice: false });
      expect(await auditCount(practice, 'appointment.cancel_by_practice', id)).toBe(0);
    });
  });

  describe('a session with both factors left alone (03 §5)', () => {
    it('goes on within 30 minutes of a refresh, and ends after them', async () => {
      const practice = world.alNoor();
      const team = await member();
      world.clock.set(NOW.add({ minutes: 30 }));
      const kept = await refresh(team.refreshToken).expect(200);
      const { tokens } = kept.body as { tokens: { accessToken: string; refreshToken: string } };
      await day({ ...team, token: tokens.accessToken }, practice).expect(200);
      world.clock.set(NOW.add({ minutes: 61 }));
      const ended = await refresh(tokens.refreshToken).expect(401);
      expect(ended.body).toMatchObject({ code: 'UNAUTHENTICATED' });
      // The whole sign-in ended, not only this token.
      const left = await world
        .platform()
        .session.count({ where: { userId: team.userId, revokedAt: null } });
      expect(left).toBe(0);
    });
  });

  describe('who may reach the desk', () => {
    it('admits every role of the team with both factors (A04)', async () => {
      const practice = world.alNoor();
      for (const role of ['STAFF', 'DOCTOR', 'MANAGER'] as const) {
        const who = await member(role);
        const response = await day(who, practice).expect(200);
        expect((response.body as Day).today).toBe('2026-11-15');
      }
    });

    it('asks for the second factor first, also of a patient', async () => {
      const practice = world.alNoor();
      const patient = await world.patient(practice);
      const refused = await day(patient, practice).expect(403);
      expect(refused.body).toMatchObject({ code: 'MFA_REQUIRED' });
      const staff = await world.person();
      await world.app().get(StaffRoles).setRole(staff.email, 'STAFF', 'local:test');
      const passwordOnly = await day(staff, practice).expect(403);
      expect(passwordOnly.body).toMatchObject({ code: 'MFA_REQUIRED' });
    });

    it('answers 404 in another practice and after the membership ends', async () => {
      const team = await member();
      const elsewhere = await day(team, world.lindenhof()).expect(404);
      expect(elsewhere.body).toMatchObject({ code: 'NOT_FOUND' });
      await world.app().get(StaffRoles).setRole(team.email, null, 'local:test');
      const ended = await day(team, world.alNoor()).expect(404);
      expect(ended.body).toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});

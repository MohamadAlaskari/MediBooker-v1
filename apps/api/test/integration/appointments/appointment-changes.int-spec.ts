/**
 * Cancelling, rescheduling and reading the own appointments against real databases (08 B03).
 * What happens at the same time is in booking.concurrency.int-spec.ts.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { PracticeAudit } from '../../../src/common/tenancy/practice-audit.js';
import { PracticeKeys } from '../../../src/common/tenancy/practice-keys.js';
import { API, type Fixture, NOW, type Person, useBookingWorld } from './booking-world.js';

interface AppointmentBody {
  id: string;
  practiceId: string;
  patientId: string;
  serviceId: string;
  serviceName: Record<string, string>;
  providerId: string | null;
  providerName: string | null;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  status: string;
  changeableUntil: string;
  changeable: boolean;
  started: boolean;
}

interface PageBody {
  items: AppointmentBody[];
  nextCursor: string | null;
}

describe('changing and reading the own appointments on real databases (08 B03)', () => {
  const world = useBookingWorld();

  const booked = async (
    who: Person,
    practice: Fixture,
    startsAt: Temporal.Instant,
    extra: object = {},
  ): Promise<AppointmentBody> => {
    const response = await world
      .book(who, practice, {
        serviceId: practice.serviceId,
        startsAt: startsAt.toString(),
        ...extra,
      })
      .expect(201);
    return response.body as AppointmentBody;
  };

  const read = (who: Person, practice: Fixture, id: string): request.Test =>
    world.send(
      request(world.server()).get(
        `${API}/practices/${practice.practice.practiceId}/appointments/${id}`,
      ),
      who,
    );

  const rowOf = (
    practice: Fixture,
    id: string,
  ): Promise<
    | {
        status: string;
        cancelled_at: Date | null;
        cancelled_by_id: string | null;
        rescheduled_from_id: string | null;
        slot_status: string;
      }
    | undefined
  > =>
    world.asOwner(practice, async (owner) => {
      const { rows } = await owner.query<{
        status: string;
        cancelled_at: Date | null;
        cancelled_by_id: string | null;
        rescheduled_from_id: string | null;
        slot_status: string;
      }>(
        `SELECT a.status, a.cancelled_at, a.cancelled_by_id, a.rescheduled_from_id, s.status AS slot_status
         FROM appointments a JOIN slots s ON s.id = a.slot_id WHERE a.id = $1`,
        [id],
      );
      return rows[0];
    });

  const auditOf = (practice: Fixture, id: string): Promise<readonly string[]> =>
    world.asOwner(practice, async (owner) => {
      const { rows } = await owner.query<{ action: string }>(
        'SELECT action FROM audit_events WHERE subject_id = $1 ORDER BY at, action',
        [id],
      );
      return rows.map(({ action }) => action);
    });

  describe('cancel', () => {
    it('BR-04 cancels, says who and when, audits, and the time is free for others again', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = await world.changeableSlot(practice);
      const { id } = await booked(who, practice, startsAt);

      const response = await world.cancel(who, practice, id).expect(200);
      expect(response.body).toMatchObject({
        id,
        status: 'CANCELLED',
        changeable: false,
        started: false,
      });
      await expect(rowOf(practice, id)).resolves.toMatchObject({
        status: 'CANCELLED',
        cancelled_at: new Date(NOW.epochMilliseconds),
        cancelled_by_id: who.userId,
        slot_status: 'OPEN',
      });
      await expect(auditOf(practice, id)).resolves.toEqual([
        'appointment.book',
        'appointment.cancel',
      ]);

      const other = await world.patient(practice);
      const again = await booked(other, practice, startsAt);
      expect(again.id).not.toBe(id);
    });

    it('BR-04 at 24 elapsed hours: allowed a minute before, refused a minute after', async () => {
      const practice = world.lindenhof();
      const who = await world.patient(practice);
      // Two people: these two times overlap, which one person cannot hold (BR-25).
      const someoneElse = await world.patient(practice);
      const inTime = NOW.add({ hours: 24, minutes: 1 });
      const tooLate = NOW.add({ hours: 23, minutes: 59 });
      await world.slotAt(practice, inTime);
      await world.slotAt(practice, tooLate, { other: true });
      const allowed = await booked(who, practice, inTime);
      const refused = await booked(someoneElse, practice, tooLate);
      expect(allowed.changeable).toBe(true);
      expect(refused.changeable).toBe(false);

      await world.cancel(who, practice, allowed.id).expect(200);
      const response = await world.cancel(someoneElse, practice, refused.id).expect(409);
      expect(response.body).toMatchObject({
        code: 'CANCELLATION_DEADLINE_PASSED',
        params: { cancellationDeadlineHours: 24 },
      });
      await expect(rowOf(practice, refused.id)).resolves.toMatchObject({
        status: 'BOOKED',
        slot_status: 'BOOKED',
      });
    });

    it('answers the same to a second cancel, and changes nothing more', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const { id } = await booked(who, practice, await world.changeableSlot(practice));
      await world.cancel(who, practice, id).expect(200);
      const second = await world.cancel(who, practice, id).expect(200);
      expect(second.body).toMatchObject({ id, status: 'CANCELLED', changeable: false });
      await expect(auditOf(practice, id)).resolves.toEqual([
        'appointment.book',
        'appointment.cancel',
      ]);
    });

    it('refuses what has moved on: a checked-in appointment stays', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const { id } = await booked(who, practice, await world.changeableSlot(practice));
      await world.asOwner(practice, (owner) =>
        owner.query("UPDATE appointments SET status = 'CHECKED_IN' WHERE id = $1", [id]),
      );
      const response = await world.cancel(who, practice, id).expect(409);
      expect(response.body).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
      const answer = await read(who, practice, id).expect(200);
      expect(answer.body).toMatchObject({ status: 'CHECKED_IN', changeable: false });
    });

    it('answers 404 for another patient, for no such row and for what is no id', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const other = await world.patient(practice);
      const { id } = await booked(who, practice, await world.changeableSlot(practice));
      await world.cancel(other, practice, id).expect(404);
      await world.cancel(who, practice, randomUUID()).expect(404);
      const response = await world.cancel(who, practice, 'not-an-id').expect(404);
      expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
      await expect(rowOf(practice, id)).resolves.toMatchObject({ status: 'BOOKED' });
    });

    it('refuses a row that was moved, which would look as if the new appointment were gone', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const old = await booked(who, practice, await world.changeableSlot(practice));
      const target = await world.changeableSlot(practice);
      const moved = await world
        .reschedule(who, practice, old.id, { startsAt: target.toString() })
        .expect(201);
      const response = await world.cancel(who, practice, old.id).expect(409);
      expect(response.body).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
      await expect(rowOf(practice, (moved.body as AppointmentBody).id)).resolves.toMatchObject({
        status: 'BOOKED',
      });
    });

    it('a replay of the booking after a cancel says so, and books nothing new', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = await world.changeableSlot(practice);
      const body = { serviceId: practice.serviceId, startsAt: startsAt.toString() };
      const key = randomUUID();
      const first = await world.book(who, practice, body, key).expect(201);
      const { id } = first.body as AppointmentBody;
      await world.cancel(who, practice, id).expect(200);
      const replay = await world.book(who, practice, body, key).expect(201);
      expect(replay.body).toMatchObject({ id, status: 'CANCELLED', changeable: false });
      await expect(world.activeAt(practice, startsAt)).resolves.toEqual([]);
    });
  });

  describe('reschedule', () => {
    it('BR-05 books the new time and cancels the old one, and the note stays', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const note = 'Synthetic note';
      const old = await booked(who, practice, await world.changeableSlot(practice), {
        patientNote: note,
      });
      const target = await world.changeableSlot(practice);

      const response = await world
        .reschedule(who, practice, old.id, { startsAt: target.toString() })
        .expect(201);
      const moved = response.body as AppointmentBody;
      expect(moved).toMatchObject({
        patientId: old.patientId,
        serviceId: old.serviceId,
        startsAt: target.toString(),
        status: 'BOOKED',
        changeable: true,
        started: false,
      });
      expect(moved.id).not.toBe(old.id);
      expect(response.text).not.toContain('Synthetic');
      const oldNow = await read(who, practice, old.id).expect(200);
      expect(oldNow.body).toMatchObject({ status: 'CANCELLED', changeable: false });
      await expect(rowOf(practice, moved.id)).resolves.toMatchObject({
        status: 'BOOKED',
        rescheduled_from_id: old.id,
        slot_status: 'BOOKED',
      });
      await expect(rowOf(practice, old.id)).resolves.toMatchObject({
        status: 'CANCELLED',
        cancelled_by_id: who.userId,
        slot_status: 'OPEN',
      });
      await expect(auditOf(practice, old.id)).resolves.toEqual([
        'appointment.book',
        'appointment.cancel',
      ]);
      await expect(auditOf(practice, moved.id)).resolves.toEqual(['appointment.reschedule']);
      const sealed = await world.asOwner(practice, async (owner) => {
        const { rows } = await owner.query<{ patient_note_encrypted: string }>(
          'SELECT patient_note_encrypted FROM appointments WHERE id = $1',
          [moved.id],
        );
        return rows[0]?.patient_note_encrypted ?? '';
      });
      expect(sealed).not.toContain('Synthetic');
      await expect(
        world
          .app()
          .get(PracticeKeys)
          .decrypt(practice.practice.practiceId, sealed, `appointment:${moved.id}:patient-note`),
      ).resolves.toBe(note);

      // One copy of the note: on the row that stands, also after moving once more.
      const further = await world.changeableSlot(practice);
      const again = await world
        .reschedule(who, practice, moved.id, { startsAt: further.toString() })
        .expect(201);
      const copies = await world.asOwner(practice, async (owner) => {
        const { rows } = await owner.query<{ id: string }>(
          'SELECT id FROM appointments WHERE id = ANY($1::uuid[]) AND patient_note_encrypted IS NOT NULL',
          [[old.id, moved.id, (again.body as AppointmentBody).id]],
        );
        return rows.map(({ id }) => id);
      });
      expect(copies).toEqual([(again.body as AppointmentBody).id]);
    });

    it('BR-04 the new appointment follows its own time: moved close to now, it cannot change again', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const old = await booked(who, practice, await world.changeableSlot(practice));
      const soon = await world.freshSlot(practice);
      const response = await world
        .reschedule(who, practice, old.id, { startsAt: soon.toString() })
        .expect(201);
      expect(response.body).toMatchObject({
        startsAt: soon.toString(),
        status: 'BOOKED',
        changeable: false,
        started: false,
      });
    });

    it('BR-05 a failure on the way keeps the old appointment, and a retry with the key moves it', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const old = await booked(who, practice, await world.changeableSlot(practice));
      const target = await world.changeableSlot(practice);
      const key = randomUUID();
      const record = vi
        .spyOn(world.app().get(PracticeAudit), 'record')
        .mockRejectedValueOnce(new Error('forced'));
      await world
        .reschedule(who, practice, old.id, { startsAt: target.toString() }, key)
        .expect(500);
      record.mockRestore();
      await expect(rowOf(practice, old.id)).resolves.toMatchObject({
        status: 'BOOKED',
        cancelled_at: null,
        slot_status: 'BOOKED',
      });
      await expect(world.activeAt(practice, target)).resolves.toEqual([]);
      await world
        .reschedule(who, practice, old.id, { startsAt: target.toString() }, key)
        .expect(201);
    });

    it('answers a replay with the same move, and refuses the key for another request', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const old = await booked(who, practice, await world.changeableSlot(practice));
      const target = await world.changeableSlot(practice);
      const other = await world.changeableSlot(practice);
      const key = randomUUID();
      const body = { startsAt: target.toString() };
      const first = await world.reschedule(who, practice, old.id, body, key).expect(201);
      const replay = await world.reschedule(who, practice, old.id, body, key).expect(201);
      expect((replay.body as AppointmentBody).id).toBe((first.body as AppointmentBody).id);
      const reused = await world
        .reschedule(who, practice, old.id, { startsAt: other.toString() }, key)
        .expect(409);
      expect(reused.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    });

    it('BR-01 refuses a time that is taken, and keeps the old appointment', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const old = await booked(who, practice, await world.changeableSlot(practice));
      const rival = await world.patient(practice);
      const target = await world.changeableSlot(practice);
      await booked(rival, practice, target);
      const response = await world
        .reschedule(who, practice, old.id, { startsAt: target.toString() })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
      await expect(rowOf(practice, old.id)).resolves.toMatchObject({ status: 'BOOKED' });
    });

    it('BR-25 refuses a move onto another own appointment, and keeps the old one', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const old = await booked(who, practice, await world.changeableSlot(practice));
      const target = await world.changeableSlot(practice);
      await booked(who, practice, target);
      await world.slotAt(practice, target, { other: true });
      const response = await world
        .reschedule(who, practice, old.id, { startsAt: target.toString() })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'APPOINTMENT_OVERLAP' });
      await expect(rowOf(practice, old.id)).resolves.toMatchObject({ status: 'BOOKED' });
    });

    it('BR-25 does not count the appointment being moved: the same time with another doctor', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = await world.changeableSlot(practice);
      await world.slotAt(practice, startsAt, { other: true });
      const old = await booked(who, practice, startsAt);
      await world.reschedule(who, practice, old.id, { startsAt: startsAt.toString() }).expect(201);
      await expect(rowOf(practice, old.id)).resolves.toMatchObject({ status: 'CANCELLED' });
    });

    it('refuses the same time with the same doctor, which is no other time', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = await world.changeableSlot(practice);
      const old = await booked(who, practice, startsAt);
      const response = await world
        .reschedule(who, practice, old.id, { startsAt: startsAt.toString() })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
      await expect(rowOf(practice, old.id)).resolves.toMatchObject({ status: 'BOOKED' });
    });

    it('BR-04 refuses after the deadline, and BR-03 refuses a new time outside the window', async () => {
      const practice = world.lindenhof();
      const who = await world.patient(practice);
      const soon = await world.freshSlot(practice);
      const old = await booked(who, practice, soon);
      const target = await world.changeableSlot(practice);
      const late = await world
        .reschedule(who, practice, old.id, { startsAt: target.toString() })
        .expect(409);
      expect(late.body).toMatchObject({ code: 'CANCELLATION_DEADLINE_PASSED' });

      const later = await booked(who, practice, await world.changeableSlot(practice));
      const outside = await world
        .reschedule(who, practice, later.id, { startsAt: NOW.add({ minutes: 30 }).toString() })
        .expect(409);
      expect(outside.body).toMatchObject({ code: 'OUTSIDE_BOOKING_WINDOW' });
    });

    it('refuses what was cancelled, and answers 404 for another patient', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const other = await world.patient(practice);
      const old = await booked(who, practice, await world.changeableSlot(practice));
      const target = await world.changeableSlot(practice);
      const body = { startsAt: target.toString() };
      await world.reschedule(other, practice, old.id, body).expect(404);
      await world.reschedule(who, practice, 'not-an-id', body).expect(404);
      await world.cancel(who, practice, old.id).expect(200);
      const response = await world.reschedule(who, practice, old.id, body).expect(409);
      expect(response.body).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    });

    it('BR-02 moves an appointment also at the limit: it is one, before and after', async () => {
      const practice = world.lindenhof();
      await world.setRules(practice, { limit: 1 });
      const who = await world.patient(practice);
      const old = await booked(who, practice, await world.changeableSlot(practice));
      const target = await world.changeableSlot(practice);
      const response = await world.reschedule(who, practice, old.id, {
        startsAt: target.toString(),
      });
      await world.setRules(practice);
      expect(response.status).toBe(201);
    });

    it('needs a key that is a UUID, and takes who moves from the token', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const old = await booked(who, practice, await world.changeableSlot(practice));
      const target = await world.changeableSlot(practice);
      const body = { startsAt: target.toString() };
      await world.reschedule(who, practice, old.id, body, 'not-a-uuid').expect(400);
      await world
        .reschedule(who, practice, old.id, { ...body, patientId: randomUUID() })
        .expect(400);
      await world.reschedule(undefined, practice, old.id, body).expect(401);
      await expect(rowOf(practice, old.id)).resolves.toMatchObject({ status: 'BOOKED' });
    });
  });

  describe('reading', () => {
    const listOf = (who: Person, practice: Fixture, query: object): request.Test =>
      world.send(
        request(world.server())
          .get(`${API}/practices/${practice.practice.practiceId}/me/appointments`)
          .query(query),
        who,
      );

    it('says what a person needs to know, and names a doctor only with a public profile', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const startsAt = await world.changeableSlot(practice);
      await world.slotAt(practice, startsAt, { other: true });
      const named = await booked(who, practice, startsAt);
      const other = await world.patient(practice);
      const unnamed = await booked(other, practice, startsAt);

      const answer = await read(who, practice, named.id).expect(200);
      expect(answer.body).toEqual({
        id: named.id,
        practiceId: practice.practice.practiceId,
        patientId: named.patientId,
        serviceId: practice.serviceId,
        serviceName: expect.any(Object) as object,
        providerId: practice.providerId,
        providerName: expect.any(String) as string,
        startsAt: startsAt.toString(),
        endsAt: startsAt.add({ minutes: 30 }).toString(),
        timeZone: 'Asia/Riyadh',
        numberingSystem: expect.any(String) as string,
        hourCycle: expect.any(String) as string,
        status: 'BOOKED',
        bookedAt: NOW.toString(),
        changeableUntil: startsAt.subtract({ hours: 24 }).toString(),
        changeable: true,
        started: false,
      });
      expect(unnamed).toMatchObject({ providerId: null, providerName: null });
    });

    it('answers 404 for an appointment of another patient, or no id', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const other = await world.patient(practice);
      const { id } = await booked(who, practice, await world.changeableSlot(practice));
      const ofOther = await read(other, practice, id);
      const noId = await read(who, practice, 'not-an-id');
      expect([ofOther.status, noId.status]).toEqual([404, 404]);
    });

    it('lists what is to come soonest first, and the rest latest first', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const later = await booked(who, practice, await world.changeableSlot(practice));
      const soon = await booked(who, practice, await world.freshSlot(practice));
      const past = await world.freshSlot(practice);
      const other = await world.patient(practice);
      await booked(other, practice, past);

      const upcoming = await listOf(who, practice, { scope: 'upcoming' }).expect(200);
      expect((upcoming.body as PageBody).items.map(({ id }) => id)).toEqual([soon.id, later.id]);

      await world.cancel(who, practice, later.id).expect(200);
      const cancelled = await listOf(who, practice, { scope: 'past' }).expect(200);
      expect((cancelled.body as PageBody).items.map(({ id }) => id)).toEqual([later.id]);
      const left = await listOf(who, practice, {}).expect(200);
      expect((left.body as PageBody).items.map(({ id }) => id)).toEqual([soon.id]);

      world.clock.set(Temporal.Instant.from(soon.startsAt).add({ minutes: 1 }));
      const fresh = { ...who, token: await world.signIn(who.email) };
      const after = await listOf(fresh, practice, { scope: 'past' }).expect(200);
      expect((after.body as PageBody).items).toMatchObject([
        { id: later.id, status: 'CANCELLED', started: false, changeable: false },
        // Nothing sets another status yet (M05): only `started` tells that this one has begun.
        { id: soon.id, status: 'BOOKED', started: true, changeable: false },
      ]);
    });

    it('goes through a list a page at a time, without losing or repeating anything', async () => {
      const practice = world.lindenhof();
      await world.setRules(practice, { limit: 5 });
      const who = await world.patient(practice);
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const { id } = await booked(who, practice, await world.changeableSlot(practice));
        ids.push(id);
      }
      await world.setRules(practice);

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 3; page += 1) {
        const response: request.Response = await listOf(who, practice, {
          limit: 2,
          ...(cursor === null ? {} : { cursor }),
        }).expect(200);
        const body = response.body as PageBody;
        seen.push(...body.items.map(({ id }) => id));
        cursor = body.nextCursor;
      }
      expect(seen).toEqual(ids);
      expect(cursor).toBeNull();
    });

    it('refuses a limit above 100, another scope and a cursor it did not give', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      await listOf(who, practice, { limit: 101 }).expect(400);
      await listOf(who, practice, { scope: 'all' }).expect(400);
      const cursor = Buffer.from('anything', 'utf8').toString('base64url');
      await listOf(who, practice, { cursor }).expect(400);
      const noDate = Buffer.from(`99999999999999999:${randomUUID()}`, 'utf8').toString('base64url');
      const response = await listOf(who, practice, { cursor: noDate }).expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('refuses as a cursor an appointment of someone else, and tells nothing of it', async () => {
      const practice = world.alNoor();
      const who = await world.patient(practice);
      const other = await world.patient(practice);
      const { id } = await booked(other, practice, await world.changeableSlot(practice));
      const cursor = Buffer.from(id, 'utf8').toString('base64url');
      const response = await listOf(who, practice, { cursor }).expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('keeps the time of an appointment out of a cursor', async () => {
      const practice = world.lindenhof();
      const who = await world.patient(practice);
      const { id } = await booked(who, practice, await world.changeableSlot(practice));
      await booked(who, practice, await world.changeableSlot(practice));
      const page = await listOf(who, practice, { limit: 1 }).expect(200);
      const { nextCursor } = page.body as PageBody;
      expect(Buffer.from(nextCursor ?? '', 'base64url').toString('utf8')).toBe(id);
    });

    it('answers 404 before a join, and shows nobody else', async () => {
      const practice = world.alNoor();
      const stranger = await world.person();
      await listOf(stranger, practice, {}).expect(404);
      const who = await world.patient(practice);
      const other = await world.patient(practice);
      await booked(other, practice, await world.changeableSlot(practice));
      const mine = await listOf(who, practice, {}).expect(200);
      expect((mine.body as PageBody).items).toEqual([]);
    });
  });
});

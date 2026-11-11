/**
 * The team's lists on real databases (08 M05, W5 and W8): patients found by name in Arabic and Latin
 * letters however written, by phone, date of birth and insurance number; one patient's record; the
 * appointments of some days narrowed as the team chooses; the catalogue; the audit of every read.
 * A search travels in the body of a POST, never in a URL.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { PracticeKeys } from '../../../src/common/tenancy/practice-keys.js';
import { searchTextOf } from '../../../src/modules/appointments/domain/patient-search.rules.js';
import { base32Decode, hotp, stepOf } from '../../../src/modules/auth/domain/totp.js';
import { StaffRoles } from '../../../src/modules/staff/staff-roles.js';
import { API, type Fixture, type Person, useBookingWorld } from './booking-world.js';

const SLUG = 'al-noor';

interface Found {
  items: { id: string; firstName: string; lastName: string }[];
  nextCursor: string | null;
  total: number | null;
}

/** A cursor as the API writes one: base64url of the row's id. */
const cursorOf = (id: string): string => Buffer.from(id).toString('base64url');

describe('the team’s lists on real databases (08 M05)', () => {
  const world = useBookingWorld({ PRACTICE_SLUG: SLUG });
  const ids: Record<'sara' | 'juergen' | 'sami' | 'mustafa', string> = {
    sara: '',
    juergen: '',
    sami: '',
    mustafa: '',
  };
  let sara: Person;
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
  const get = (who: Person, url: string): request.Test =>
    world.send(request(world.server()).get(url), who);
  const post = (who: Person, url: string, body: object = {}): request.Test =>
    world.send(request(world.server()).post(url), who).send(body);
  const patients = async (body: object): Promise<Found> =>
    (await post(team, desk(world.alNoor(), 'patients/search'), body).expect(200)).body as Found;
  const auditCount = (action: string, subjectId: string): Promise<number> =>
    world.asOwner(world.alNoor(), async (owner) => {
      const { rows } = await owner.query<{ count: string }>(
        'SELECT count(*) FROM audit_events WHERE action = $1 AND subject_id = $2',
        [action, subjectId],
      );
      return Number(rows[0]?.count ?? 0);
    });

  beforeAll(async () => {
    const practice = world.alNoor();
    sara = await world.person();
    ids.sara = await world.join(sara, practice, {
      firstName: 'سارة',
      lastName: 'الأحمد',
      dateOfBirth: '1987-06-21',
      insuranceType: 'SELF_PAY',
      phone: '+966 50 123 4567',
    });
    ids.juergen = await world.join(await world.person(), practice, {
      firstName: 'Jürgen',
      lastName: 'Müller',
      dateOfBirth: '1975-01-02',
      insuranceType: 'SELF_PAY',
      phone: '٠٥٥ ٩٨٧ ٦٥٤٣',
    });
    ids.sami = await world.join(await world.person(), practice, {
      firstName: 'سامي',
      lastName: 'بيسبيل',
      dateOfBirth: '1990-04-12',
      insuranceType: 'SELF_PAY',
    });
    // Tashkeel, an alef maqsura, a wasla alef and a tatweel, all in one name.
    ids.mustafa = await world.join(await world.person(), practice, {
      firstName: 'مُصْطَفَى',
      lastName: 'ٱلْـهَاشِمِيّ',
      dateOfBirth: '1969-12-31',
      insuranceType: 'SELF_PAY',
    });
    // A number as B01 keeps it: only its keyed hash can be compared.
    const hash = await world
      .app()
      .get(PracticeKeys)
      .keyedHash(practice.practice.practiceId, 'insurance-number', 'A123456789');
    await world.asOwner(practice, (owner) =>
      owner.query(
        `UPDATE patients SET insurance_type = 'PUBLIC', insurance_provider = 'Synthetic Insurance',
           insurance_number_encrypted = 'sealed', insurance_number_end = '6789',
           insurance_number_index = $1
         WHERE id = $2`,
        [hash, ids.sami],
      ),
    );
    team = await member();
  });

  describe('finding a patient (W8)', () => {
    it('finds "سارة" with and without tashkeel, written with ه, and in any order (M05 acceptance)', async () => {
      for (const query of ['سارة', 'سَارَة', 'ساره', 'احمد سارة', 'سـارة  الاحمد', 'سارة سارة']) {
        const found = await patients({ query });
        expect(found.items.map(({ id }) => id)).toEqual([ids.sara]);
        expect(found.total).toBe(1);
      }
      expect((await patients({ query: 'مصطفي الهاشمي' })).items.map(({ id }) => id)).toEqual([
        ids.mustafa,
      ]);
    });

    it('keeps every name folded in the database exactly as a search folds it', async () => {
      const rows = await world.asOwner(world.alNoor(), async (owner) => {
        const { rows: found } = await owner.query<{
          first_name: string;
          last_name: string;
          search_name: string;
        }>('SELECT first_name, last_name, search_name FROM patients');
        return found;
      });
      expect(rows.length).toBeGreaterThanOrEqual(4);
      for (const row of rows) {
        expect(row.search_name).toBe(searchTextOf(`${row.first_name} ${row.last_name}`));
      }
      // The trigger follows a change of the name, whoever writes it.
      await world.asOwner(world.alNoor(), (owner) =>
        owner.query(`UPDATE patients SET first_name = 'Jürgen-Peter' WHERE id = $1`, [ids.juergen]),
      );
      expect((await patients({ query: 'peter muller' })).items.map(({ id }) => id)).toEqual([
        ids.juergen,
      ]);
      await world.asOwner(world.alNoor(), (owner) =>
        owner.query(`UPDATE patients SET first_name = 'Jürgen' WHERE id = $1`, [ids.juergen]),
      );
      expect((await patients({ query: 'peter' })).total).toBe(0);
    });

    it('finds a Latin name whatever its case and accents', async () => {
      for (const query of ['muller', 'MÜLLER jürgen', 'Juergen'.replace('ue', 'u')]) {
        expect((await patients({ query })).items.map(({ id }) => id)).toEqual([ids.juergen]);
      }
    });

    it('finds digits of a phone number in either set of digits, and a date of birth', async () => {
      expect((await patients({ query: '0559876543' })).items.map(({ id }) => id)).toEqual([
        ids.juergen,
      ]);
      expect((await patients({ query: '٥٠١٢٣٤٥' })).items.map(({ id }) => id)).toEqual([ids.sara]);
      // Typed as a local number, stored with the country code (+966 50 123 4567).
      expect((await patients({ query: '050 123 4567' })).items.map(({ id }) => id)).toEqual([
        ids.sara,
      ]);
      expect((await patients({ query: '21.06.1987' })).items.map(({ id }) => id)).toEqual([
        ids.sara,
      ]);
      // The year 0 is no date of birth: no search by it, and no error of the database.
      await post(team, desk(world.alNoor(), 'patients/search'), { query: '0000-01-01' }).expect(
        200,
      );
    });

    it('finds an insurance number by its blind index only', async () => {
      expect((await patients({ query: 'a123 456 789' })).items.map(({ id }) => id)).toEqual([
        ids.sami,
      ]);
      expect((await patients({ query: 'A12345678' })).total).toBe(0);
    });

    it('goes through the patients a page at a time, counting on the first page only', async () => {
      const first = await patients({ query: 'سا', limit: 1 });
      expect(first.total).toBe(2);
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      const second = await patients({ query: 'سا', limit: 1, cursor: first.nextCursor ?? '' });
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect(second.total).toBeNull();
      expect([first.items[0]?.id, second.items[0]?.id].toSorted()).toEqual(
        [ids.sara, ids.sami].toSorted(),
      );
      expect((await patients({ query: 'سا', insuranceType: 'PRIVATE' })).total).toBe(0);
    });

    it('tells nothing after a cursor past the end, and takes no cursor of another list', async () => {
      // A cursor may name any patient here: after the last one in the order of the list, a search
      // shows no one, and so may not count whether someone matches (security review of M05).
      const last = await world.asOwner(world.alNoor(), async (owner) => {
        const { rows } = await owner.query<{ id: string }>(
          'SELECT id FROM patients ORDER BY last_name DESC, first_name DESC, id DESC LIMIT 1',
        );
        return rows[0]?.id ?? '';
      });
      expect(await patients({ query: 'Müller 02.01.1975', cursor: cursorOf(last) })).toMatchObject({
        items: [],
        total: null,
        nextCursor: null,
      });
      const elsewhere = await world.join(await world.person(), world.lindenhof());
      for (const cursor of ['bm8', cursorOf(elsewhere), cursorOf(randomUUID())]) {
        const refused = await post(team, desk(world.alNoor(), 'patients/search'), {
          cursor,
        }).expect(400);
        expect(refused.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      }
    });

    it('writes an audit event for each patient a list shows, once in five minutes', async () => {
      // The tests before listed him within these five minutes already: no row of theirs counts.
      const before = await auditCount('patient.list', ids.juergen);
      await patients({ query: 'Müller' });
      expect(await auditCount('patient.list', ids.juergen)).toBe(before);
      world.clock.set(world.clock.now().add({ minutes: 6 }));
      await patients({ query: 'Müller' });
      await patients({ query: 'Müller' });
      expect(await auditCount('patient.list', ids.juergen)).toBe(before + 1);
    });
  });

  describe('one patient', () => {
    it('shows what is to come and what was, and audits the read and its appointments', async () => {
      const practice = world.alNoor();
      await world
        .book(sara, practice, {
          serviceId: practice.serviceId,
          startsAt: (await world.changeableSlot(practice)).toString(),
        })
        .expect(201);
      const record = await get(team, desk(practice, `patients/${ids.sara}`)).expect(200);
      expect(record.body).toMatchObject({
        patient: {
          id: ids.sara,
          firstName: 'سارة',
          email: sara.email,
          phone: '+966 50 123 4567',
        },
        insuranceNumberEnd: null,
        recent: [],
      });
      const { upcoming } = record.body as { upcoming: { id: string }[] };
      expect(upcoming).toHaveLength(1);
      expect(await auditCount('patient.read', ids.sara)).toBe(1);
      expect(await auditCount('appointment.list', upcoming[0]?.id ?? '')).toBe(1);
    });

    it('answers 404 for no patient of this practice', async () => {
      const elsewhere = await world.join(await world.person(), world.lindenhof());
      const refused = await get(team, desk(world.alNoor(), `patients/${elsewhere}`)).expect(404);
      expect(refused.body).toMatchObject({ code: 'NOT_FOUND' });
      await get(team, desk(world.alNoor(), 'patients/not-an-id')).expect(404);
    });
  });

  describe('the appointments of some days (W5)', () => {
    it('narrows the list by patient, doctor, service and status, a page at a time', async () => {
      const practice = world.alNoor();
      const later = await world.changeableSlot(practice);
      await world
        .book(sara, practice, { serviceId: practice.serviceId, startsAt: later.toString() })
        .expect(201);
      const from = later.subtract({ hours: 72 }).toZonedDateTimeISO('Asia/Riyadh').toPlainDate();
      const to = from.add({ days: 6 }).toString();
      const range = { from: from.toString(), to };
      const list = async (search: object) =>
        (
          await post(team, desk(practice, 'appointments/search'), { ...range, ...search }).expect(
            200,
          )
        ).body as Found & { from: string; to: string };
      const bySara = await list({ query: 'سَارَة' });
      expect(bySara).toMatchObject({ from: range.from, to, total: 2 });
      expect(await list({ patientId: ids.sara })).toMatchObject({ total: 2 });
      expect(await list({ query: 'سَارَة', providerId: practice.providerId })).toMatchObject({
        total: 2,
      });
      expect(await list({ query: 'سَارَة', serviceId: practice.serviceId })).toMatchObject({
        total: 2,
      });
      expect(await list({ query: 'سَارَة', status: 'CANCELLED' })).toMatchObject({ total: 0 });
      expect(await list({ query: 'xyz-no-one' })).toMatchObject({ total: 0 });
      expect(await list({ query: '050 123 4567' })).toMatchObject({ total: 2 });
      const first = await list({ query: 'سَارَة', limit: 1 });
      expect(first.items).toHaveLength(1);
      const second = await list({ query: 'سَارَة', limit: 1, cursor: first.nextCursor ?? '' });
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect(second.total).toBeNull();
      expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
      expect(await auditCount('appointment.list', first.items[0]?.id ?? '')).toBe(1);
      // After the last one: nothing shown, nothing counted.
      expect(
        await list({ patientId: ids.sara, cursor: cursorOf(second.items[0]?.id ?? '') }),
      ).toMatchObject({ items: [], total: null, nextCursor: null });
    });

    it('refuses a span of more than 92 days, and one that runs backwards', async () => {
      const url = desk(world.alNoor(), 'appointments/search');
      for (const range of [
        { from: '2026-11-01', to: '2027-02-01' },
        { from: '2026-11-02', to: '2026-11-01' },
      ]) {
        const refused = await post(team, url, range).expect(400);
        expect(refused.body).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: [{ field: 'to' }],
        });
      }
    });
  });

  describe('the catalogue and who reaches it all', () => {
    it('names the doctors and the services of the practice', async () => {
      const practice = world.alNoor();
      const catalog = await get(team, desk(practice, 'catalog')).expect(200);
      const body = catalog.body as {
        providers: { id: string; name: string }[];
        services: { id: string }[];
      };
      expect(body.providers.map(({ id }) => id)).toContain(practice.providerId);
      expect(body.providers.every(({ name }) => name !== '')).toBe(true);
      expect(body.services.map(({ id }) => id)).toContain(practice.serviceId);
    });

    it('asks a patient for the second factor before anything else', async () => {
      const practice = world.alNoor();
      for (const path of ['catalog', `patients/${ids.sara}`]) {
        const refused = await get(sara, desk(practice, path)).expect(403);
        expect(refused.body).toMatchObject({ code: 'MFA_REQUIRED' });
      }
      for (const path of ['appointments/search', 'patients/search']) {
        const refused = await post(sara, desk(practice, path), { query: 'سارة' }).expect(403);
        expect(refused.body).toMatchObject({ code: 'MFA_REQUIRED' });
      }
    });
  });
});

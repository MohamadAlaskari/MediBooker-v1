/**
 * A person's profile in a practice against real databases (08 B01): the join, the index and its
 * relay, the keys per practice and the patient routes.
 */
import { randomUUID } from 'node:crypto';
import { PRIVACY_NOTICE_VERSION } from '@medibooker/i18n';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { provisionPractice, type ProvisionedPractice } from '@medibooker/db-migrate/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformPrismaService } from '../../src/common/database/platform-prisma.service.js';
import { IntegrationRelay } from '../../src/common/tenancy/integration-relay.js';
import { PracticeAccessIndex } from '../../src/common/tenancy/practice-access-index.js';
import { PracticeConnectionManager } from '../../src/common/tenancy/practice-connection-manager.js';
import { PracticeKeys } from '../../src/common/tenancy/practice-keys.js';
import { FixedClock } from '../../src/common/time/fixed-clock.js';
import { createTestApp } from '../support/create-test-app.js';
import { captureLogs } from '../support/log-capture.js';
import { usePracticeDatabases } from '../support/practices.js';
import { withClient } from './support/sql.js';

const API = '/api/v1';
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const PASSWORD = 'synthetic correct horse battery';
const GERMAN_NUMBER = 'A123456789';
const ARABIC_NUMBER = `A${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => String.fromCodePoint(0x0660 + digit)).join('')}`;
const PROFILE = {
  firstName: 'Sami',
  lastName: 'Beispiel',
  dateOfBirth: '1990-04-12',
  phone: '+966 50 000 0000',
  insuranceType: 'PUBLIC',
  insuranceProvider: 'Synthetic Health',
  insuranceNumber: GERMAN_NUMBER,
};

interface Person {
  readonly userId: string;
  readonly email: string;
  readonly token: string;
}

interface PatientBody {
  id: string;
  firstName: string;
  phone: string | null;
  insuranceType: string;
  insuranceProvider: string | null;
  insuranceNumberEnd: string | null;
}

interface PatientRow {
  user_id: string;
  first_name: string;
  insurance_number_encrypted: string | null;
  insurance_number_end: string | null;
  insurance_number_index: string | null;
}

describe('patient profiles on real databases (08 B01)', () => {
  const databases = usePracticeDatabases({ practices: 'none' });
  const clock = new FixedClock(NOW);
  const logs = captureLogs();
  let app: NestExpressApplication;
  let riyadh: ProvisionedPractice;
  let berlin: ProvisionedPractice;
  let unpublished: ProvisionedPractice;
  let people = 0;
  let clients = 0;
  let client = '';

  const server = (): ReturnType<NestExpressApplication['getHttpServer']> => app.getHttpServer();
  const platform = (): PlatformPrismaService => app.get(PlatformPrismaService);
  const asOwner = async <T>(
    practice: ProvisionedPractice,
    work: (owner: Awaited<ReturnType<ProvisionedPractice['connectAsOwner']>>) => Promise<T>,
  ): Promise<T> => {
    const owner = await practice.connectAsOwner();
    return work(owner).finally(() => owner.end());
  };
  const inRegistry = async (sql: string, values: unknown[]): Promise<void> => {
    await withClient(databases.platformOwnerUrl, (owner) => owner.query(sql, values));
  };
  const publish = async (practice: ProvisionedPractice, slug: string): Promise<void> => {
    await inRegistry('INSERT INTO practice_slugs (slug, practice_id) VALUES ($1, $2)', [
      slug,
      practice.practiceId,
    ]);
    await inRegistry('UPDATE practices SET name = $2, published_at = now() WHERE id = $1', [
      practice.practiceId,
      { en: slug },
    ]);
  };
  const rowOf = (practice: ProvisionedPractice, userId: string): Promise<PatientRow | undefined> =>
    asOwner(practice, async (owner) => {
      const { rows } = await owner.query<PatientRow>('SELECT * FROM patients WHERE user_id = $1', [
        userId,
      ]);
      return rows[0];
    });

  const signIn = async (email: string): Promise<string> => {
    const login = await request(server())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', client)
      .send({ email, password: PASSWORD, delivery: 'body' })
      .expect(200);
    return (login.body as { tokens: { accessToken: string } }).tokens.accessToken;
  };

  /** An account; by default with its address confirmed, and signed in for a Bearer header. */
  const person = async ({ confirmed = true } = {}): Promise<Person> => {
    people += 1;
    const email = `patient-${String(people)}@example.test`;
    await request(server())
      .post(`${API}/auth/register`)
      .set('X-Forwarded-For', client)
      .send({
        email,
        password: PASSWORD,
        locale: 'en',
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      })
      .expect(202);
    const user = await platform().user.findUniqueOrThrow({ where: { email } });
    if (confirmed) {
      await platform().user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date(NOW.epochMilliseconds) },
      });
    }
    return { userId: user.id, email, token: await signIn(email) };
  };
  const send = (test: request.Test, who: Person | undefined): request.Test => {
    test.set('X-Forwarded-For', client);
    return who === undefined ? test : test.set('Authorization', `Bearer ${who.token}`);
  };
  const saveProfile = async (who: Person, details: object = PROFILE): Promise<void> => {
    await send(request(server()).put(`${API}/me/profile`), who)
      .send(details)
      .expect(200);
  };
  const join = (who: Person | undefined, practiceId: string, body: object = {}): request.Test =>
    send(request(server()).post(`${API}/practices/${practiceId}/me/patients`), who).send(body);
  const getPatient = (
    who: Person | undefined,
    practiceId: string,
    patientId: string,
  ): request.Test =>
    send(request(server()).get(`${API}/practices/${practiceId}/me/patients/${patientId}`), who);
  const patch = (who: Person, practiceId: string, patientId: string, body: object): request.Test =>
    send(
      request(server()).patch(`${API}/practices/${practiceId}/me/patients/${patientId}`),
      who,
    ).send(body);
  const myPractices = (who: Person): request.Test =>
    send(request(server()).get(`${API}/me/practices`), who);
  const statusOf = async (test: request.Test): Promise<number> => (await test).status;
  const fieldErrorsOf = (body: unknown): readonly { field: string; code: string }[] =>
    (body as { errors: { field: string; code: string }[] }).errors.map(({ field, code }) => ({
      field,
      code,
    }));
  const joined = async (who: Person, practice = riyadh): Promise<PatientBody> => {
    const response = await join(who, practice.practiceId).expect(201);
    return response.body as PatientBody;
  };

  beforeAll(async () => {
    riyadh = await databases.provision({ market: 'SA', timeZone: 'Asia/Riyadh' });
    berlin = await databases.provision({ market: 'DE', timeZone: 'Europe/Berlin' });
    unpublished = await databases.provision({ market: 'SA' });
    await publish(riyadh, 'riyadh-practice');
    await publish(berlin, 'berlin-practice');
    app = await createTestApp({
      // One proxy in front, so that each test is its own client with its own limits.
      env: { ...databases.apiEnv, TRUST_PROXY_HOPS: '1' },
      logDestination: logs,
      clock,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    clients += 1;
    client = `203.0.113.${String(clients)}`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clock.set(NOW);
  });

  describe('POST /practices/{practiceId}/me/patients', () => {
    it('copies the details of the account, under the key of the practice', async () => {
      const who = await person();
      await saveProfile(who);
      const body = await joined(who);
      expect(body).toEqual({
        id: expect.any(String) as string,
        firstName: 'Sami',
        lastName: 'Beispiel',
        dateOfBirth: '1990-04-12',
        phone: '+966 50 000 0000',
        insuranceType: 'PUBLIC',
        insuranceProvider: 'Synthetic Health',
        insuranceNumberEnd: '6789',
      });
      const row = await rowOf(riyadh, who.userId);
      expect(row?.first_name).toBe('Sami');
      expect(row?.insurance_number_encrypted).not.toContain(GERMAN_NUMBER);
      await expect(
        app
          .get(PracticeKeys)
          .decrypt(
            riyadh.practiceId,
            row?.insurance_number_encrypted ?? '',
            `patient:${body.id}:insurance-number`,
          ),
      ).resolves.toBe(GERMAN_NUMBER);
    });

    it('records the join in the audit log of the practice, with a hash for the address', async () => {
      const who = await person();
      await saveProfile(who);
      const { id } = await joined(who);
      const rows = await asOwner(riyadh, async (owner) => {
        const result = await owner.query<{ actor: string; action: string; ip_hash: string }>(
          'SELECT actor, action, ip_hash FROM audit_events WHERE subject_id = $1',
          [id],
        );
        return result.rows;
      });
      expect(rows).toEqual([
        {
          actor: `user:${who.userId}`,
          action: 'patient.join',
          ip_hash: expect.any(String) as string,
        },
      ]);
      expect(rows[0]?.ip_hash).not.toContain(client);
    });

    it('asks only for what is missing, all of it in one answer', async () => {
      const who = await person();
      const first = await join(who, riyadh.practiceId).expect(400);
      expect(fieldErrorsOf(first.body)).toEqual([
        { field: 'firstName', code: 'REQUIRED' },
        { field: 'lastName', code: 'REQUIRED' },
        { field: 'dateOfBirth', code: 'REQUIRED' },
        { field: 'insuranceType', code: 'REQUIRED' },
      ]);
      const second = await join(who, riyadh.practiceId, {
        firstName: 'Sami',
        lastName: 'Beispiel',
        dateOfBirth: '1990-04-12',
        insuranceType: 'SELF_PAY',
      }).expect(201);
      expect(second.body).toMatchObject({ insuranceType: 'SELF_PAY', insuranceNumberEnd: null });
    });

    it('takes a change at the join over the copy, and no number of another type', async () => {
      const who = await person();
      await saveProfile(who);
      const asked = await join(who, riyadh.practiceId, {
        insuranceType: 'PRIVATE',
        insuranceProvider: 'Other Synthetic',
      }).expect(400);
      expect(fieldErrorsOf(asked.body)).toEqual([{ field: 'insuranceNumber', code: 'REQUIRED' }]);
      const taken = await join(who, riyadh.practiceId, {
        firstName: 'Samira',
        insuranceType: 'PRIVATE',
        insuranceProvider: 'Other Synthetic',
        insuranceNumber: 'PRIV-998877',
      }).expect(201);
      expect(taken.body).toMatchObject({
        firstName: 'Samira',
        insuranceType: 'PRIVATE',
        insuranceNumberEnd: '8877',
      });
    });

    it('refuses a date that is none, and a birth date in the future', async () => {
      const who = await person();
      await saveProfile(who);
      for (const dateOfBirth of ['2026-02-31', '2030-01-01']) {
        const response = await join(who, riyadh.practiceId, { dateOfBirth }).expect(400);
        expect(fieldErrorsOf(response.body)).toEqual([
          { field: 'dateOfBirth', code: 'INVALID_VALUE' },
        ]);
      }
    });

    it('follows BR-09: a session does not mean a confirmed address', async () => {
      const who = await person({ confirmed: false });
      await saveProfile(who);
      const response = await join(who, riyadh.practiceId).expect(403);
      expect(response.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
      await expect(rowOf(riyadh, who.userId)).resolves.toBeUndefined();
    });

    it('asks an account without a consent for the privacy notice, and records it', async () => {
      const who = await person();
      await saveProfile(who);
      await platform().accountConsent.deleteMany({ where: { userId: who.userId } });
      const asked = await join(who, riyadh.practiceId).expect(400);
      expect(fieldErrorsOf(asked.body)).toEqual([
        { field: 'privacyNoticeVersion', code: 'REQUIRED' },
      ]);
      await join(who, riyadh.practiceId, { privacyNoticeVersion: 'an-old-version' }).expect(400);
      await join(who, riyadh.practiceId, {
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      }).expect(201);
      const consents = await platform().accountConsent.findMany({ where: { userId: who.userId } });
      expect(consents.map(({ textVersion }) => textVersion)).toEqual([PRIVACY_NOTICE_VERSION]);
    });

    it('asks again after a new version of the privacy notice', async () => {
      const who = await person();
      await saveProfile(who);
      await platform().accountConsent.updateMany({
        where: { userId: who.userId },
        data: { textVersion: '2020-01' },
      });
      const asked = await join(who, riyadh.practiceId).expect(400);
      expect(fieldErrorsOf(asked.body)).toEqual([
        { field: 'privacyNoticeVersion', code: 'REQUIRED' },
      ]);
    });

    it('limits an address per minute, in front of the sign-in, and never for a day', async () => {
      let last = await join(undefined, riyadh.practiceId);
      for (let sent = 1; sent < 11; sent += 1) last = await join(undefined, riyadh.practiceId);
      expect(last.status).toBe(429);
      expect(Number(last.headers['retry-after'])).toBeLessThanOrEqual(60);
    });

    it('answers 404 for a practice without a publication, and for one that does not exist', async () => {
      const who = await person();
      await saveProfile(who);
      expect(await statusOf(join(who, unpublished.practiceId))).toBe(404);
      expect(await statusOf(join(who, randomUUID()))).toBe(404);
      expect(await statusOf(join(who, 'not-a-uuid'))).toBe(404);
      expect(await statusOf(join(undefined, riyadh.practiceId))).toBe(401);
    });

    it('rejects a second own profile: as an answer, and in the index of the database', async () => {
      const who = await person();
      await saveProfile(who);
      const { id } = await joined(who);
      const again = await join(who, riyadh.practiceId).expect(409);
      expect(again.body).toMatchObject({ code: 'ALREADY_JOINED' });
      await expect(
        asOwner(riyadh, (owner) =>
          owner.query(
            `INSERT INTO patients (user_id, relationship, first_name, last_name, date_of_birth, insurance_type)
             VALUES ($1, 'SELF', 'x', 'y', '1990-01-01', 'SELF_PAY')`,
            [who.userId],
          ),
        ),
      ).rejects.toThrow(/patients_self_user_key/u);
      await getPatient(who, riyadh.practiceId, id).expect(200);
    });

    it('lets one of two joins at the same time through', async () => {
      const who = await person();
      await saveProfile(who);
      const answers = await Promise.all([
        join(who, riyadh.practiceId),
        join(who, riyadh.practiceId),
      ]);
      expect(answers.map(({ status }) => status).sort()).toEqual([201, 409]);
    });

    it('keeps the number from being stored for a practice without a key', async () => {
      const withoutKey = await databases.provision({ market: 'SA' });
      await publish(withoutKey, 'keyless-practice');
      await inRegistry("UPDATE practices SET field_key_refs = '{}' WHERE id = $1", [
        withoutKey.practiceId,
      ]);
      const who = await person();
      await saveProfile(who);
      await join(who, withoutKey.practiceId).expect(503);
      await expect(rowOf(withoutKey, who.userId)).resolves.toBeUndefined();
      // Nothing stays behind: neither a place in the day's limit nor a consent.
      await expect(
        platform().practiceAccess.count({ where: { userId: who.userId } }),
      ).resolves.toBe(0);
    });

    describe('the limit of an account', () => {
      /** An index row for a practice joined earlier, so that a test needs no six databases. */
      const earlierJoin = async (who: Person): Promise<void> => {
        const practiceId = randomUUID();
        await inRegistry('INSERT INTO practices (id, market) VALUES ($1, $2)', [practiceId, 'SA']);
        await platform().practiceAccess.create({
          data: {
            userId: who.userId,
            practiceId,
            capacity: 'PATIENT',
            active: true,
            createdAt: new Date(NOW.epochMilliseconds),
          },
        });
      };

      it('answers the sixth join of a day with 429, and takes it the next day', async () => {
        const who = await person();
        await saveProfile(who);
        for (let done = 0; done < 5; done += 1) await earlierJoin(who);
        const refused = await join(who, riyadh.practiceId).expect(429);
        expect(refused.body).toMatchObject({ code: 'RATE_LIMITED' });
        await expect(rowOf(riyadh, who.userId)).resolves.toBeUndefined();
        clock.set(NOW.add({ hours: 25 }));
        await join({ ...who, token: await signIn(who.email) }, riyadh.practiceId).expect(201);
      });

      it('holds with joins at the same time', async () => {
        const who = await person();
        await saveProfile(who, {
          ...PROFILE,
          insuranceNumber: undefined,
          insuranceType: 'SELF_PAY',
          insuranceProvider: undefined,
        });
        for (let done = 0; done < 4; done += 1) await earlierJoin(who);
        const answers = await Promise.all([
          join(who, riyadh.practiceId),
          join(who, berlin.practiceId),
        ]);
        expect(answers.map(({ status }) => status).sort()).toEqual([201, 429]);
      });
    });
  });

  describe('the insurance of a market (BR-10)', () => {
    it('takes a letter and nine digits for the public insurance in Germany', async () => {
      const who = await person();
      await saveProfile(who, { ...PROFILE, insuranceNumber: 'NOT-THE-FORMAT' });
      const refused = await join(who, berlin.practiceId).expect(400);
      expect(fieldErrorsOf(refused.body)).toEqual([
        { field: 'insuranceNumber', code: 'INVALID_VALUE' },
      ]);
      await join(who, berlin.practiceId, { insuranceNumber: GERMAN_NUMBER }).expect(201);
    });

    it('asks a self-payer for no number, and refuses a type the practice does not take', async () => {
      const selfPayer = await person();
      await saveProfile(selfPayer, {
        firstName: 'Sami',
        lastName: 'Beispiel',
        dateOfBirth: '1990-04-12',
        insuranceType: 'SELF_PAY',
      });
      const body = await joined(selfPayer, berlin);
      expect(body).toMatchObject({ insuranceProvider: null, insuranceNumberEnd: null });

      const onlySelfPay = await databases.provision({ market: 'SA' });
      await publish(onlySelfPay, 'self-pay-practice');
      await asOwner(onlySelfPay, (owner) =>
        owner.query("UPDATE practice_settings SET insurance_types = '{SELF_PAY}'"),
      );
      const insured = await person();
      await saveProfile(insured);
      const refused = await join(insured, onlySelfPay.practiceId).expect(400);
      expect(fieldErrorsOf(refused.body)).toEqual([
        { field: 'insuranceType', code: 'INVALID_VALUE' },
      ]);
    });

    it('gives the same number in two scripts one spelling, also in the blind index', async () => {
      const latin = await person();
      await saveProfile(latin);
      const arabic = await person();
      await saveProfile(arabic, { ...PROFILE, insuranceNumber: ARABIC_NUMBER });
      await joined(latin, berlin);
      await joined(arabic, berlin);
      const [first, second] = await Promise.all([
        rowOf(berlin, latin.userId),
        rowOf(berlin, arabic.userId),
      ]);
      expect(first?.insurance_number_end).toBe('6789');
      expect(second?.insurance_number_end).toBe('6789');
      expect(second?.insurance_number_index).toBe(first?.insurance_number_index);
    });

    it('gives the same number another key and another blind index in another practice', async () => {
      const who = await person();
      await saveProfile(who);
      await joined(who, riyadh);
      await joined(who, berlin);
      const [inRiyadh, inBerlin] = await Promise.all([
        rowOf(riyadh, who.userId),
        rowOf(berlin, who.userId),
      ]);
      const keyId = (row: PatientRow | undefined): string | undefined =>
        row?.insurance_number_encrypted?.split('.')[0];
      expect(keyId(inRiyadh)).not.toBe(keyId(inBerlin));
      expect(inRiyadh?.insurance_number_index).not.toBe(inBerlin?.insurance_number_index);
    });
  });

  describe('the patient routes', () => {
    it('answers 401, 403, 404 and 200 as the matrix says', async () => {
      const who = await person();
      await saveProfile(who);
      const { id } = await joined(who);
      expect(await statusOf(getPatient(undefined, riyadh.practiceId, id))).toBe(401);
      expect(await statusOf(getPatient(who, riyadh.practiceId, id))).toBe(200);
      expect(await statusOf(getPatient(who, riyadh.practiceId, randomUUID()))).toBe(404);

      const stranger = await person();
      expect(await statusOf(getPatient(stranger, riyadh.practiceId, id))).toBe(404);

      const staffOnly = await person();
      await platform().practiceAccess.create({
        data: {
          userId: staffOnly.userId,
          practiceId: riyadh.practiceId,
          capacity: 'STAFF',
          active: true,
        },
      });
      expect(await statusOf(getPatient(staffOnly, riyadh.practiceId, id))).toBe(403);
    });

    it('answers 404 in another practice, and opens no client there', async () => {
      const who = await person();
      await saveProfile(who);
      const { id } = await joined(who);
      const acquire = vi.spyOn(app.get(PracticeConnectionManager), 'acquire');
      await getPatient(who, berlin.practiceId, id).expect(404);
      expect(acquire).not.toHaveBeenCalled();
    });

    it('shows a patient only their own profile', async () => {
      const first = await person();
      await saveProfile(first);
      const second = await person();
      await saveProfile(second);
      const { id: firstId } = await joined(first);
      await joined(second);
      await getPatient(second, riyadh.practiceId, firstId).expect(404);
      await patch(second, riyadh.practiceId, firstId, { firstName: 'Taken' }).expect(404);
      await expect(rowOf(riyadh, first.userId)).resolves.toMatchObject({ first_name: 'Sami' });
    });

    it('lets the database of the practice overrule a stale index row', async () => {
      const who = await person();
      await saveProfile(who);
      const { id } = await joined(who);
      await asOwner(riyadh, (owner) => owner.query('DELETE FROM patients WHERE id = $1', [id]));
      expect(await statusOf(getPatient(who, riyadh.practiceId, id))).toBe(404);
    });

    it('lists the own profile for a second device, and answers 404 before a join', async () => {
      const who = await person();
      await saveProfile(who);
      const list = (): request.Test =>
        send(request(server()).get(`${API}/practices/${riyadh.practiceId}/me/patients`), who);
      expect(await statusOf(list())).toBe(404);
      const { id } = await joined(who);
      const response = await list().expect(200);
      expect((response.body as { items: PatientBody[] }).items.map((item) => item.id)).toEqual([
        id,
      ]);
    });

    it('leaves a self-payer no number when changes come at the same time', async () => {
      const who = await person();
      await saveProfile(who);
      const { id } = await joined(who);
      for (let round = 0; round < 5; round += 1) {
        const answers = await Promise.all([
          patch(who, riyadh.practiceId, id, { insuranceType: 'SELF_PAY' }),
          patch(who, riyadh.practiceId, id, {
            insuranceType: 'PUBLIC',
            insuranceProvider: 'Synthetic Health',
            insuranceNumber: GERMAN_NUMBER,
          }),
        ]);
        expect(answers.map(({ status }) => status)).toEqual([200, 200]);
        const row = await asOwner(riyadh, async (owner) => {
          const { rows } = await owner.query<{
            insurance_type: string;
            insurance_number_encrypted: string | null;
          }>('SELECT insurance_type, insurance_number_encrypted FROM patients WHERE id = $1', [id]);
          return rows[0];
        });
        expect(row?.insurance_number_encrypted === null).toBe(row?.insurance_type === 'SELF_PAY');
      }
    });

    it('never lets the database hold a number for a self-payer', async () => {
      await expect(
        asOwner(riyadh, (owner) =>
          owner.query(
            `INSERT INTO patients (first_name, last_name, date_of_birth, relationship, insurance_type, insurance_number_encrypted)
             VALUES ('x', 'y', '1990-01-01', 'CHILD', 'SELF_PAY', 'sealed')`,
          ),
        ),
      ).rejects.toThrow(/patients_self_pay_keeps_nothing_check/u);
    });

    it('never answers with the full number', async () => {
      const who = await person();
      await saveProfile(who);
      const { id } = await joined(who);
      const read = await getPatient(who, riyadh.practiceId, id).expect(200);
      const changed = await patch(who, riyadh.practiceId, id, { phone: null }).expect(200);
      for (const { text } of [read, changed]) {
        expect(text).not.toContain(GERMAN_NUMBER);
        expect(text).not.toContain('insuranceNumberEncrypted');
        expect(text).not.toContain('insuranceNumberIndex');
      }
      expect(changed.body).toMatchObject({ phone: null, insuranceNumberEnd: '6789' });
    });

    it('changes what is given, and keeps the rest', async () => {
      const who = await person();
      await saveProfile(who);
      const { id } = await joined(who);
      const response = await patch(who, riyadh.practiceId, id, { firstName: 'Samira' }).expect(200);
      expect(response.body).toMatchObject({
        firstName: 'Samira',
        lastName: 'Beispiel',
        insuranceType: 'PUBLIC',
        insuranceNumberEnd: '6789',
      });
    });

    it('checks a new number, and encrypts it again', async () => {
      const who = await person();
      await saveProfile(who);
      const { id } = await joined(who, berlin);
      const before = await rowOf(berlin, who.userId);
      await patch(who, berlin.practiceId, id, { insuranceNumber: 'WRONG-FORMAT' }).expect(400);
      await patch(who, berlin.practiceId, id, { insuranceNumber: 'B987654321' }).expect(200);
      const after = await rowOf(berlin, who.userId);
      expect(after?.insurance_number_end).toBe('4321');
      expect(after?.insurance_number_encrypted).not.toBe(before?.insurance_number_encrypted);
      expect(after?.insurance_number_index).not.toBe(before?.insurance_number_index);
    });

    it('forgets provider and number when a person starts to pay themselves', async () => {
      const who = await person();
      await saveProfile(who);
      const { id } = await joined(who);
      const response = await patch(who, riyadh.practiceId, id, {
        insuranceType: 'SELF_PAY',
      }).expect(200);
      expect(response.body).toMatchObject({
        insuranceType: 'SELF_PAY',
        insuranceProvider: null,
        insuranceNumberEnd: null,
      });
      const row = await rowOf(riyadh, who.userId);
      expect(row?.insurance_number_encrypted).toBeNull();
      expect(row?.insurance_number_index).toBeNull();
    });

    it('needs a new number for another type, and writes each change to the audit log', async () => {
      const who = await person();
      await saveProfile(who);
      const { id } = await joined(who);
      const asked = await patch(who, riyadh.practiceId, id, { insuranceType: 'PRIVATE' }).expect(
        400,
      );
      expect(fieldErrorsOf(asked.body)).toEqual([
        { field: 'insuranceProvider', code: 'REQUIRED' },
        { field: 'insuranceNumber', code: 'REQUIRED' },
      ]);
      await patch(who, riyadh.practiceId, id, { dateOfBirth: '2030-01-01' }).expect(400);
      await patch(who, riyadh.practiceId, id, { firstName: 'Samira' }).expect(200);
      const actions = await asOwner(riyadh, async (owner) => {
        const { rows } = await owner.query<{ action: string }>(
          'SELECT action FROM audit_events WHERE subject_id = $1 ORDER BY at',
          [id],
        );
        return rows.map(({ action }) => action).sort();
      });
      expect(actions).toEqual(['patient.join', 'patient.update']);
    });
  });

  describe('GET /me/practices', () => {
    it('lists the practices of the caller and no others, with the capacity', async () => {
      const who = await person();
      await saveProfile(who);
      const other = await person();
      await saveProfile(other);
      await joined(other, berlin);
      expect((await myPractices(who).expect(200)).body).toEqual({ items: [] });
      await joined(who, riyadh);
      expect((await myPractices(who).expect(200)).body).toEqual({
        items: [
          {
            id: riyadh.practiceId,
            slug: 'riyadh-practice',
            name: { en: 'riyadh-practice' },
            capacity: 'PATIENT',
          },
        ],
      });
    });

    it('does not list a place that is only reserved', async () => {
      const who = await person();
      await platform().practiceAccess.create({
        data: { userId: who.userId, practiceId: riyadh.practiceId, capacity: 'PATIENT' },
      });
      expect((await myPractices(who).expect(200)).body).toEqual({ items: [] });
    });
  });

  describe('the membership index', () => {
    it('is applied by the relay when the write-through fails, and fails closed until then', async () => {
      const who = await person();
      await saveProfile(who);
      const index = app.get(PracticeAccessIndex);
      vi.spyOn(index, 'apply').mockRejectedValueOnce(new Error('platform away'));
      const { id } = await joined(who);
      await getPatient(who, riyadh.practiceId, id).expect(404);
      await expect(index.capacitiesOf(who.userId, riyadh.practiceId)).resolves.toEqual([]);
      await app.get(IntegrationRelay).run();
      await getPatient(who, riyadh.practiceId, id).expect(200);
    });

    it('marks an event as done, also after the write-through', async () => {
      const who = await person();
      await saveProfile(who);
      await joined(who);
      const pending = await asOwner(riyadh, async (owner) => {
        const { rows } = await owner.query<{ count: string }>(
          `SELECT count(*) FROM integration_outbox
           WHERE processed_at IS NULL AND payload->>'userId' = $1`,
          [who.userId],
        );
        return rows[0]?.count;
      });
      expect(pending).toBe('0');
    });

    it('ignores an older event, and a replayed one changes nothing', async () => {
      const who = await person();
      const index = app.get(PracticeAccessIndex);
      const change = { userId: who.userId, capacity: 'PATIENT', active: true } as const;
      await index.apply(riyadh.practiceId, 10n, change);
      await index.apply(riyadh.practiceId, 9n, { ...change, active: false });
      await index.apply(riyadh.practiceId, 10n, { ...change, active: false });
      await expect(index.capacitiesOf(who.userId, riyadh.practiceId)).resolves.toEqual(['PATIENT']);
      await index.apply(riyadh.practiceId, 11n, { ...change, active: false });
      await expect(index.capacitiesOf(who.userId, riyadh.practiceId)).resolves.toEqual([]);
    });

    it('changes only the practice an event was read from', async () => {
      const who = await person();
      await asOwner(berlin, (owner) =>
        owner.query(
          "INSERT INTO integration_outbox (type, payload) VALUES ('ACCESS_CHANGED', $1)",
          [{ userId: who.userId, capacity: 'PATIENT', active: true }],
        ),
      );
      await app.get(IntegrationRelay).run();
      const index = app.get(PracticeAccessIndex);
      await expect(index.capacitiesOf(who.userId, berlin.practiceId)).resolves.toEqual(['PATIENT']);
      await expect(index.capacitiesOf(who.userId, riyadh.practiceId)).resolves.toEqual([]);
    });

    it('survives an event for an account that is gone', async () => {
      await asOwner(berlin, (owner) =>
        owner.query(
          "INSERT INTO integration_outbox (type, payload) VALUES ('ACCESS_CHANGED', $1)",
          [{ userId: randomUUID(), capacity: 'PATIENT', active: true }],
        ),
      );
      const summary = await app.get(IntegrationRelay).run();
      expect(summary.failed).toBe(0);
    });
  });

  describe('what stays out', () => {
    it.each(['template', 'full'] as const)(
      'keeps the audit log append-only for the app role of a practice (%s path)',
      async (path) => {
        const appRole = await databases.connectAsApp(await databases.provision({ path }));
        try {
          await appRole.query(
            `INSERT INTO audit_events (at, actor, action) VALUES (now(), 'user:x', 'test.action')`,
          );
          await expect(appRole.query('UPDATE audit_events SET action = $1', ['x'])).rejects.toThrow(
            /permission denied/u,
          );
          await expect(appRole.query('DELETE FROM audit_events')).rejects.toThrow(
            /permission denied/u,
          );
        } finally {
          await appRole.end();
        }
      },
    );

    it('gives a practice its data key, also on a rerun, and never replaces one in use', async () => {
      const { practiceId } = await databases.provision({ path: 'full' });
      const refsOf = async (): Promise<readonly string[]> =>
        (
          await platform().practice.findUniqueOrThrow({
            where: { id: practiceId },
            select: { fieldKeyRefs: true },
          })
        ).fieldKeyRefs;
      const provisionAgain = (): Promise<unknown> =>
        provisionPractice({
          practiceId,
          market: 'SA',
          appEnv: 'ci',
          platformUrl: databases.platformOwnerUrl,
          provisionerUrl: databases.provisionerUrl,
          secretStore: databases.secretStore,
        });
      const first = await refsOf();
      expect(first).toEqual([expect.stringMatching(/^dev:practice_[0-9a-f]{32}_field_key$/u)]);

      // A practice from before B01.
      await inRegistry("UPDATE practices SET field_key_refs = '{}' WHERE id = $1", [practiceId]);
      await provisionAgain();
      await expect(refsOf()).resolves.toEqual(first);

      await inRegistry("UPDATE practices SET field_key_refs = '{dev:rotated}' WHERE id = $1", [
        practiceId,
      ]);
      await provisionAgain();
      await expect(refsOf()).resolves.toEqual(['dev:rotated']);
    });

    it('logs neither a number nor a name nor an address of a patient', async () => {
      const who = await person();
      await saveProfile(who);
      const { id } = await joined(who);
      await patch(who, riyadh.practiceId, id, { firstName: 'Samira' }).expect(200);
      const text = logs.text();
      for (const marker of [GERMAN_NUMBER, 'Samira', 'Beispiel', who.email, client]) {
        expect(text).not.toContain(marker);
      }
    });
  });
});

/**
 * The team page of practice management against real databases (M03 part 1, D17): the list, a base
 * role with practice management and the doctor, the last manager, deactivating and reactivating,
 * and a lost authenticator app. Synthetic accounts only.
 */
import { PRIVACY_NOTICE_VERSION } from '@medibooker/i18n';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ProvisionedPractice } from '@medibooker/db-migrate/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlatformPrismaService } from '../../src/common/database/platform-prisma.service.js';
import { FixedClock } from '../../src/common/time/fixed-clock.js';
import { base32Decode, hotp, stepOf } from '../../src/modules/auth/domain/totp.js';
import { AccountOutbox } from '../../src/modules/notifications/account-outbox.js';
import { type Email, EmailSender } from '../../src/modules/notifications/email-sender.js';
import { StaffRoles } from '../../src/modules/staff/staff-roles.js';
import { createTestApp } from '../support/create-test-app.js';
import { usePracticeDatabases } from '../support/practices.js';
import { withClient } from './support/sql.js';
import { placeOf, type TeamRole } from './support/team-roles.js';

const API = '/api/v1';
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const PASSWORD = 'synthetic correct horse battery';
const SLUG = 'team-practice';
const SUBJECTS = {
  changed: 'Your place in the practice team has changed',
  ended: "Your access to the practice team's pages has ended",
  reset: 'The authenticator app was removed from your account',
} as const;

interface Member {
  readonly userId: string;
  readonly email: string;
  /** A session with both factors. */
  readonly token: string;
  readonly secret: string;
}

interface TeamMember {
  id: string;
  email: string;
  role: string;
  managesPractice: boolean;
  active: boolean;
  secondFactor: boolean;
  doctor: { id: string; name: string } | null;
  you: boolean;
}

describe('the team page of practice management on real databases (M03, D17)', () => {
  const databases = usePracticeDatabases({ practices: 'none' });
  const clock = new FixedClock(NOW);
  const sent: Email[] = [];
  const sender = {
    send: (email: Email): Promise<void> => {
      sent.push(email);
      return Promise.resolve();
    },
  };
  let app: NestExpressApplication;
  let practice: ProvisionedPractice;
  let people = 0;
  let clients = 0;
  let client = '';

  const server = (): ReturnType<NestExpressApplication['getHttpServer']> => app.getHttpServer();
  const platform = (): PlatformPrismaService => app.get(PlatformPrismaService);
  const inPractice = async <T>(sql: string, values: unknown[] = []): Promise<T[]> => {
    const owner = await practice.connectAsOwner();
    try {
      return (await owner.query(sql, values)).rows as T[];
    } finally {
      await owner.end();
    }
  };
  const as = (test: request.Test, token: string): request.Test =>
    test.set('X-Forwarded-For', client).set('Authorization', `Bearer ${token}`);
  const codeOf = (body: unknown): string | undefined => (body as { code?: string }).code;
  const login = (email: string, extra: object = {}): request.Test =>
    request(server())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', client)
      .send({ email, password: PASSWORD, delivery: 'body', ...extra });
  const tokenOf = (response: request.Response): string =>
    (response.body as { tokens: { accessToken: string } }).tokens.accessToken;

  /** An account with a confirmed address, in the team with this place, its app set up. */
  const member = async (role: TeamRole, providerId?: string): Promise<Member> => {
    people += 1;
    const email = `team-${String(people)}@example.test`;
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
    const user = await platform().user.update({
      where: { email },
      data: { emailVerifiedAt: new Date(NOW.epochMilliseconds) },
      select: { id: true },
    });
    const place = placeOf(role);
    await app.get(StaffRoles).setRole(email, place.role, 'local:test', {
      managesPractice: place.managesPractice,
      ...(providerId === undefined ? {} : { providerId }),
    });
    const password = tokenOf(await login(email).expect(200));
    const start = await as(request(server()).post(`${API}/me/mfa/totp`), password).expect(200);
    const { secret } = start.body as { secret: string };
    const confirmed = await as(request(server()).post(`${API}/me/mfa/totp/confirm`), password)
      .send({ code: hotp(base32Decode(secret), stepOf(clock.now())) })
      .expect(200);
    return { userId: user.id, email, token: tokenOf(confirmed), secret };
  };

  const staffPath = (rest = ''): string =>
    `${API}/practices/${practice.practiceId}/staff${rest === '' ? '' : `/${rest}`}`;
  const list = (who: Member): request.Test => as(request(server()).get(staffPath()), who.token);
  const membershipIdOf = async (who: { userId: string }): Promise<string> => {
    const [row] = await inPractice<{ id: string }>(
      'SELECT id FROM memberships WHERE user_id = $1',
      [who.userId],
    );
    return row?.id ?? '';
  };
  const changeRole = (by: Member, membershipId: string, body: object): request.Test =>
    as(request(server()).put(staffPath(`${membershipId}/role`)), by.token).send(body);
  const post = (by: Member, membershipId: string, action: string): request.Test =>
    as(request(server()).post(staffPath(`${membershipId}/${action}`)), by.token);
  const auditCount = async (action: string, subjectId: string): Promise<number> => {
    const [row] = await inPractice<{ count: string }>(
      'SELECT count(*) FROM audit_events WHERE action = $1 AND subject_id = $2',
      [action, subjectId],
    );
    return Number(row?.count ?? 0);
  };
  const newDoctor = async (lastName: string): Promise<string> => {
    const [row] = await inPractice<{ id: string }>(
      `INSERT INTO staff_members (first_name, last_name, is_provider)
       VALUES ('Synthetic', $1, true) RETURNING id`,
      [lastName],
    );
    return row?.id ?? '';
  };
  /** What the outbox sends now, to this address: every batch that is due, not only the first. */
  const subjectsTo = async (to: string): Promise<string[]> => {
    const outbox = app.get(AccountOutbox);
    for (let batch = 0; batch < 50; batch += 1) {
      const { succeeded, failed } = await outbox.processDue();
      if (succeeded + failed === 0) break;
    }
    return sent.filter((email) => email.to === to).map(({ subject }) => subject);
  };

  beforeAll(async () => {
    practice = await databases.provision({ market: 'SA', timeZone: 'Asia/Riyadh' });
    await withClient(databases.platformOwnerUrl, async (owner) => {
      await owner.query('INSERT INTO practice_slugs (slug, practice_id) VALUES ($1, $2)', [
        SLUG,
        practice.practiceId,
      ]);
      await owner.query('UPDATE practices SET name = $2, published_at = now() WHERE id = $1', [
        practice.practiceId,
        { en: 'Synthetic Team Practice', ar: 'عيادة الفريق التجريبية' },
      ]);
    });
    app = await createTestApp({
      // One proxy in front, so that each test is its own client with its own limits.
      env: { ...databases.apiEnv, TRUST_PROXY_HOPS: '1', PRACTICE_SLUG: SLUG },
      clock,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    clients += 1;
    client = `203.0.113.${String(clients)}`;
  });

  describe('the list', () => {
    it('is for practice management only, and names each member and its doctor', async () => {
      const doctorId = await newDoctor('Lister');
      const manager = await member('MANAGER');
      const doctor = await member('DOCTOR', doctorId);
      const reception = await member('STAFF');
      for (const refused of [doctor, reception]) {
        const response = await list(refused).expect(403);
        expect(codeOf(response.body)).toBe('FORBIDDEN');
      }
      const { members, doctors } = (await list(manager).expect(200)).body as {
        members: TeamMember[];
        doctors: { id: string; membershipId: string | null }[];
      };
      const byEmail = new Map(members.map((one) => [one.email, one]));
      expect(byEmail.get(manager.email)).toMatchObject({
        role: 'STAFF',
        managesPractice: true,
        active: true,
        secondFactor: true,
        you: true,
      });
      expect(byEmail.get(doctor.email)).toMatchObject({
        role: 'DOCTOR',
        managesPractice: false,
        doctor: { id: doctorId, name: 'Synthetic Lister' },
        you: false,
      });
      expect(doctors.find(({ id }) => id === doctorId)?.membershipId).toBe(
        await membershipIdOf(doctor),
      );
    });
  });

  describe('a role', () => {
    it('changes base role, management and doctor; audits each and tells the person', async () => {
      const doctorId = await newDoctor('Changer');
      const manager = await member('MANAGER');
      const reception = await member('STAFF');
      const id = await membershipIdOf(reception);
      // The operator's command that made the member wrote its own row already.
      const before = await auditCount('staff.role.set', id);
      const answer = await changeRole(manager, id, {
        role: 'DOCTOR',
        managesPractice: true,
        providerId: doctorId,
      }).expect(200);
      expect(answer.body).toMatchObject({
        role: 'DOCTOR',
        managesPractice: true,
        doctor: { id: doctorId },
      });
      expect(await auditCount('staff.role.set', id)).toBe(before + 1);
      expect(await auditCount('staff.management.grant', id)).toBe(1);
      expect(await auditCount('staff.provider.link', doctorId)).toBe(1);
      expect(await subjectsTo(reception.email)).toContain(SUBJECTS.changed);
      // The same again changes nothing, and tells nobody.
      sent.length = 0;
      await changeRole(manager, id, { role: 'DOCTOR', managesPractice: true }).expect(200);
      expect(await auditCount('staff.role.set', id)).toBe(before + 1);
      expect(await subjectsTo(reception.email)).toEqual([]);
      // The person's own membership says so on its next request.
      const own = await as(
        request(server()).get(`${API}/practices/${practice.practiceId}/me/membership`),
        reception.token,
      ).expect(200);
      expect(own.body).toEqual({ role: 'DOCTOR', managesPractice: true, providerId: doctorId });
    });

    it('takes a doctor only for a doctor, a doctor of the practice, and only once', async () => {
      const doctorId = await newDoctor('Once');
      const manager = await member('MANAGER');
      const first = await member('DOCTOR', doctorId);
      const second = await member('STAFF');
      const secondId = await membershipIdOf(second);
      const asStaff = await changeRole(manager, secondId, {
        role: 'STAFF',
        managesPractice: false,
        providerId: doctorId,
      }).expect(400);
      expect(asStaff.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'providerId' }],
      });
      const unknown = await changeRole(manager, secondId, {
        role: 'DOCTOR',
        managesPractice: false,
        providerId: '99999999-9999-4999-8999-999999999999',
      }).expect(400);
      expect(unknown.body).toMatchObject({ errors: [{ field: 'providerId' }] });
      const taken = await changeRole(manager, secondId, {
        role: 'DOCTOR',
        managesPractice: false,
        providerId: doctorId,
      }).expect(409);
      expect(codeOf(taken.body)).toBe('DOCTOR_ALREADY_LINKED');
      // Another role drops the link, and the doctor can be another account.
      await changeRole(manager, await membershipIdOf(first), {
        role: 'STAFF',
        managesPractice: false,
      }).expect(200);
      await changeRole(manager, secondId, {
        role: 'DOCTOR',
        managesPractice: false,
        providerId: doctorId,
      }).expect(200);
      expect(await auditCount('staff.provider.unlink', doctorId)).toBe(1);
    });

    it('keeps the last active manager, and lets one go once another has it', async () => {
      const managerOf = async (): Promise<number> =>
        Number(
          (
            await inPractice<{ count: string }>(
              `SELECT count(*) FROM memberships WHERE manages_practice AND status = 'ACTIVE'`,
            )
          )[0]?.count ?? 0,
        );
      // Every manager of the tests before goes, but one.
      const keeper = await member('MANAGER');
      await inPractice(
        `UPDATE memberships SET manages_practice = false WHERE manages_practice AND user_id <> $1`,
        [keeper.userId],
      );
      expect(await managerOf()).toBe(1);
      const own = await membershipIdOf(keeper);
      const refused = await changeRole(keeper, own, {
        role: 'STAFF',
        managesPractice: false,
      }).expect(409);
      expect(codeOf(refused.body)).toBe('LAST_PRACTICE_MANAGER');
      const next = await member('STAFF');
      await changeRole(keeper, await membershipIdOf(next), {
        role: 'STAFF',
        managesPractice: true,
      }).expect(200);
      await changeRole(keeper, own, { role: 'STAFF', managesPractice: false }).expect(200);
      expect(await managerOf()).toBe(1);
      expect(codeOf((await list(keeper).expect(403)).body)).toBe('FORBIDDEN');
    });

    it('is refused to the team without management, and answers 404 for no such member', async () => {
      const manager = await member('MANAGER');
      const reception = await member('STAFF');
      const body = { role: 'DOCTOR', managesPractice: true };
      const refused = await changeRole(reception, await membershipIdOf(manager), body).expect(403);
      expect(codeOf(refused.body)).toBe('FORBIDDEN');
      for (const id of ['99999999-9999-4999-8999-999999999999', 'not-a-uuid']) {
        expect(codeOf((await changeRole(manager, id, body).expect(404)).body)).toBe('NOT_FOUND');
      }
    });
  });

  describe('access', () => {
    it('ends at once with every session, the index follows, and the person is told', async () => {
      const manager = await member('MANAGER');
      const reception = await member('STAFF');
      const id = await membershipIdOf(reception);
      const answer = await post(manager, id, 'deactivate').expect(200);
      expect(answer.body).toMatchObject({ active: false });
      const after = await as(
        request(server()).get(`${API}/practices/${practice.practiceId}/me/membership`),
        reception.token,
      );
      expect(after.status).toBe(401);
      expect(
        await platform().session.count({ where: { userId: reception.userId, revokedAt: null } }),
      ).toBe(0);
      const index = await platform().practiceAccess.findFirst({
        where: { userId: reception.userId, practiceId: practice.practiceId, capacity: 'STAFF' },
        select: { active: true },
      });
      expect(index?.active).toBe(false);
      expect(await auditCount('staff.deactivate', id)).toBe(1);
      expect(await subjectsTo(reception.email)).toContain(SUBJECTS.ended);
      // A second time changes nothing.
      await post(manager, id, 'deactivate').expect(200);
      expect(await auditCount('staff.deactivate', id)).toBe(1);
      // A deactivated member's role waits until it comes back.
      expect(
        codeOf(
          (await changeRole(manager, id, { role: 'DOCTOR', managesPractice: false }).expect(409))
            .body,
        ),
      ).toBe('CONFLICT');

      // A session of the deactivated time (the account still signs in) does not come back with the
      // access: every session ends first (security review of M03).
      clock.set(clock.now().add({ seconds: 30 }));
      const meanwhile = await login(reception.email, {
        code: hotp(base32Decode(reception.secret), stepOf(clock.now())),
      }).expect(200);

      // Back: the same place, a sign-in with both factors, and the team's pages again.
      await post(manager, id, 'reactivate').expect(200);
      expect(await auditCount('staff.reactivate', id)).toBe(1);
      const old = await as(
        request(server()).get(`${API}/practices/${practice.practiceId}/me/membership`),
        tokenOf(meanwhile),
      );
      expect(old.status).toBe(401);
      clock.set(clock.now().add({ seconds: 30 }));
      const signedIn = await login(reception.email, {
        code: hotp(base32Decode(reception.secret), stepOf(clock.now())),
      }).expect(200);
      await as(
        request(server()).get(`${API}/practices/${practice.practiceId}/me/membership`),
        tokenOf(signedIn),
      ).expect(200);
      clock.set(NOW);
    });

    it("is not one's own to end, and needs management", async () => {
      const manager = await member('MANAGER');
      const reception = await member('STAFF');
      const own = await post(manager, await membershipIdOf(manager), 'deactivate').expect(409);
      expect(codeOf(own.body)).toBe('NOT_ON_YOURSELF');
      const refused = await post(reception, await membershipIdOf(manager), 'deactivate').expect(
        403,
      );
      expect(codeOf(refused.body)).toBe('FORBIDDEN');
    });
  });

  describe('a lost authenticator app', () => {
    it('goes with its recovery codes and every session; the person sets up a new one', async () => {
      const manager = await member('MANAGER');
      const doctor = await member('DOCTOR');
      const id = await membershipIdOf(doctor);
      const answer = await post(manager, id, 'second-factor/reset').expect(200);
      expect(answer.body).toMatchObject({ secondFactor: false, active: true });
      const user = await platform().user.findUniqueOrThrow({
        where: { id: doctor.userId },
        select: { totpEnabledAt: true, totpSecretEncrypted: true },
      });
      expect(user).toEqual({ totpEnabledAt: null, totpSecretEncrypted: null });
      expect(await platform().mfaRecoveryCode.count({ where: { userId: doctor.userId } })).toBe(0);
      expect(
        await platform().session.count({ where: { userId: doctor.userId, revokedAt: null } }),
      ).toBe(0);
      expect(await auditCount('staff.second-factor.reset', id)).toBe(1);
      expect(
        await platform().platformAuditEvent.count({
          where: {
            action: 'auth.second-factor.reset-by-practice',
            actor: `user:${manager.userId}`,
          },
        }),
      ).toBe(1);
      expect(await subjectsTo(doctor.email)).toContain(SUBJECTS.reset);
      // The password signs in again; the team's pages want the new app first.
      const signedIn = await login(doctor.email).expect(200);
      const pages = await as(
        request(server()).get(`${API}/practices/${practice.practiceId}/me/membership`),
        tokenOf(signedIn),
      ).expect(403);
      expect(codeOf(pages.body)).toBe('MFA_REQUIRED');
      // Without an app there is nothing to take away, and nothing to tell. That sign-in's own
      // e-mail (E10) goes out first.
      await subjectsTo(doctor.email);
      sent.length = 0;
      await post(manager, id, 'second-factor/reset').expect(200);
      expect(await subjectsTo(doctor.email)).toEqual([]);
    });

    it("is not one's own to reset", async () => {
      const manager = await member('MANAGER');
      const own = await post(manager, await membershipIdOf(manager), 'second-factor/reset').expect(
        409,
      );
      expect(codeOf(own.body)).toBe('NOT_ON_YOURSELF');
    });
  });

  describe("the operator's command", () => {
    it('gives practice management to an existing member, and audits it', async () => {
      const reception = await member('STAFF');
      const outcome = await app
        .get(StaffRoles)
        .setRole(reception.email, 'STAFF', 'local:test', { managesPractice: true });
      expect(outcome).toMatchObject({ result: 'SET', role: 'STAFF', managesPractice: true });
      expect(await auditCount('staff.management.grant', await membershipIdOf(reception))).toBe(1);
    });
  });
});

/**
 * Staff and their second factor against real databases (08 A04): setting up TOTP, signing in with
 * a code or a recovery code, the wait after failures, the operator's role command and the check of
 * every staff route (MFA_REQUIRED, the index, the practice database's membership and its role).
 */
import { PRIVACY_NOTICE_VERSION } from '@medibooker/i18n';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ProvisionedPractice } from '@medibooker/db-migrate/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlatformPrismaService } from '../../src/common/database/platform-prisma.service.js';
import { FixedClock } from '../../src/common/time/fixed-clock.js';
import { base32Decode, hotp, stepOf } from '../../src/modules/auth/domain/totp.js';
import { AccountOutbox } from '../../src/modules/notifications/account-outbox.js';
import { type Email, EmailSender } from '../../src/modules/notifications/email-sender.js';
import { StaffRoles } from '../../src/modules/staff/staff-roles.js';
import { PracticeProbeModule } from '../support/practice-probe.module.js';
import { createTestApp } from '../support/create-test-app.js';
import { captureLogs } from '../support/log-capture.js';
import { usePracticeDatabases } from '../support/practices.js';
import { withClient } from './support/sql.js';

const API = '/api/v1';
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const PASSWORD = 'synthetic correct horse battery';
const NEW_PASSWORD = 'another synthetic passphrase';
const SLUG = 'staff-practice';
const OPERATOR = 'local:test';
const RESET_SUBJECT = 'Reset your password';
const APP_SUBJECT = 'An authenticator app was set up for your account';

interface Person {
  readonly userId: string;
  readonly email: string;
  readonly token: string;
}

interface TotpEnabled {
  account: { mfaEnabled: boolean };
  tokens: { accessToken: string; refreshToken: string };
  recoveryCodes: string[];
}

describe('staff and their second factor on real databases (08 A04)', () => {
  const databases = usePracticeDatabases({ practices: 'none' });
  const clock = new FixedClock(NOW);
  const logs = captureLogs();
  const sent: Email[] = [];
  const sender = {
    send: (email: Email): Promise<void> => {
      sent.push(email);
      return Promise.resolve();
    },
  };
  let app: NestExpressApplication;
  let practice: ProvisionedPractice;
  let other: ProvisionedPractice;
  let people = 0;
  let clients = 0;
  let client = '';

  const server = (): ReturnType<NestExpressApplication['getHttpServer']> => app.getHttpServer();
  const platform = (): PlatformPrismaService => app.get(PlatformPrismaService);
  const roles = (): StaffRoles => app.get(StaffRoles);
  const inRegistry = async (sql: string, values: unknown[]): Promise<void> => {
    await withClient(databases.platformOwnerUrl, (owner) => owner.query(sql, values));
  };
  const asOwner = async <T>(
    target: ProvisionedPractice,
    work: (owner: Awaited<ReturnType<ProvisionedPractice['connectAsOwner']>>) => Promise<T>,
  ): Promise<T> => {
    const owner = await target.connectAsOwner();
    return work(owner).finally(() => owner.end());
  };

  const login = (email: string, extra: object = {}): request.Test =>
    request(server())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', client)
      .send({ email, password: PASSWORD, delivery: 'body', ...extra });
  const tokenOf = (response: request.Response): string =>
    (response.body as { tokens: { accessToken: string } }).tokens.accessToken;
  const codeOf = (body: unknown): string | undefined => (body as { code?: string }).code;

  /** An account with a confirmed address, signed in with its password. */
  const person = async ({ confirmed = true } = {}): Promise<Person> => {
    people += 1;
    const email = `staff-${String(people)}@example.test`;
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
    return { userId: user.id, email, token: tokenOf(await login(email).expect(200)) };
  };
  const as = (test: request.Test, token: string): request.Test =>
    test.set('X-Forwarded-For', client).set('Authorization', `Bearer ${token}`);
  const startTotp = async (token: string): Promise<string> => {
    const response = await as(request(server()).post(`${API}/me/mfa/totp`), token).expect(200);
    return (response.body as { secret: string }).secret;
  };
  const codeAt = (secret: string, at: Temporal.Instant = clock.now()): string =>
    hotp(base32Decode(secret), stepOf(at));
  const confirmTotp = (token: string, code: string): request.Test =>
    as(request(server()).post(`${API}/me/mfa/totp/confirm`), token).send({ code });
  /** A member of the team: only the team sets up the app for now. */
  const staff = async (role: 'STAFF' | 'DOCTOR' | 'ADMIN' = 'STAFF'): Promise<Person> => {
    const who = await person();
    await roles().setRole(who.email, role, OPERATOR);
    return who;
  };
  /** The token of the newest reset e-mail to this address, as the link gives it to the page. */
  const resetToken = async (to: string): Promise<string> => {
    await app.get(AccountOutbox).processDue();
    const email = sent.findLast(
      (candidate) => candidate.to === to && candidate.subject === RESET_SUBJECT,
    );
    return /#token=([\w-]+)/.exec(email?.text ?? '')?.[1] ?? '';
  };
  /** Sets up the app of a signed-in person; the answer's session counts with both factors. */
  const withSecondFactor = async (
    who: Person,
  ): Promise<{ readonly secret: string } & TotpEnabled> => {
    const secret = await startTotp(who.token);
    const response = await confirmTotp(who.token, codeAt(secret)).expect(200);
    return { secret, ...(response.body as TotpEnabled) };
  };
  const membership = (token: string, practiceId = practice.practiceId): request.Test =>
    as(request(server()).get(`${API}/practices/${practiceId}/me/membership`), token);
  /** The next step of the clock, so that a new code is not the one accepted before. */
  const nextStep = (): void => {
    clock.set(clock.now().add({ seconds: 30 }));
  };

  beforeAll(async () => {
    practice = await databases.provision({ market: 'SA', timeZone: 'Asia/Riyadh' });
    other = await databases.provision({ market: 'SA', timeZone: 'Asia/Riyadh' });
    await inRegistry('INSERT INTO practice_slugs (slug, practice_id) VALUES ($1, $2)', [
      SLUG,
      practice.practiceId,
    ]);
    await inRegistry('UPDATE practices SET name = $2, published_at = now() WHERE id = $1', [
      practice.practiceId,
      { en: 'Synthetic Practice', ar: 'عيادة تجريبية' },
    ]);
    app = await createTestApp({
      // One proxy in front, so that each test is its own client with its own limits.
      env: { ...databases.apiEnv, TRUST_PROXY_HOPS: '1', PRACTICE_SLUG: SLUG },
      logDestination: logs,
      clock,
      imports: [PracticeProbeModule],
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

  afterEach(() => {
    clock.set(NOW);
  });

  describe('setting up the authenticator app', () => {
    it('lets only the team set it up for now', async () => {
      const who = await person();
      const refused = await as(request(server()).post(`${API}/me/mfa/totp`), who.token).expect(403);
      expect(codeOf(refused.body)).toBe('FORBIDDEN');
    });

    it('gives a secret for the practice, which counts only after a first code', async () => {
      const who = await staff();
      const response = await as(request(server()).post(`${API}/me/mfa/totp`), who.token).expect(
        200,
      );
      const { secret, otpauthUri } = response.body as { secret: string; otpauthUri: string };
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      const uri = new URL(otpauthUri);
      expect(uri.searchParams.get('issuer')).toBe('Synthetic Practice');
      expect(decodeURIComponent(uri.pathname)).toBe(`/Synthetic Practice:${who.email}`);
      // Not in force yet: the password alone still signs in.
      await login(who.email).expect(200);
      const me = await as(request(server()).get(`${API}/me`), who.token).expect(200);
      expect((me.body as { mfaEnabled: boolean }).mfaEnabled).toBe(false);
      await withClient(databases.platformOwnerUrl, async (owner) => {
        const { rows } = await owner.query<{ totp_secret_encrypted: string }>(
          'SELECT totp_secret_encrypted FROM users WHERE id = $1',
          [who.userId],
        );
        expect(rows[0]?.totp_secret_encrypted).not.toContain(secret);
      });
    });

    it('puts it in force with a first code and shows ten recovery codes once', async () => {
      const who = await staff();
      const secret = await startTotp(who.token);
      const wrong = await confirmTotp(who.token, '000000').expect(400);
      expect(codeOf(wrong.body)).toBe('MFA_CODE_INVALID');
      const response = await confirmTotp(who.token, codeAt(secret)).expect(200);
      const body = response.body as TotpEnabled;
      expect(body.account.mfaEnabled).toBe(true);
      expect(body.recoveryCodes).toHaveLength(10);
      await withClient(databases.platformOwnerUrl, async (owner) => {
        const { rows } = await owner.query<{ code_hash: string }>(
          'SELECT code_hash FROM mfa_recovery_codes WHERE user_id = $1',
          [who.userId],
        );
        expect(rows).toHaveLength(10);
        const stored = rows.map(({ code_hash }) => code_hash).join(' ');
        for (const code of body.recoveryCodes) {
          expect(stored).not.toContain(code.replace('-', ''));
        }
      });
      const again = await as(
        request(server()).post(`${API}/me/mfa/totp`),
        body.tokens.accessToken,
      ).expect(409);
      expect(codeOf(again.body)).toBe('MFA_ALREADY_ENABLED');
    });

    it('tells the mailbox once it is in force, with the way back (BR-21)', async () => {
      const who = await staff();
      const notices = async (): Promise<Email[]> => {
        await app.get(AccountOutbox).processDue();
        return sent.filter((email) => email.to === who.email && email.subject === APP_SUBJECT);
      };
      const secret = await startTotp(who.token);
      await confirmTotp(who.token, '000000').expect(400);
      expect(await notices()).toEqual([]);
      await confirmTotp(who.token, codeAt(secret)).expect(200);
      const [notice, ...more] = await notices();
      expect(more).toEqual([]);
      expect(notice?.text).toMatch(/\/en\/secure-account#token=[\w-]+/);
      expect(notice?.text).toContain('ask the practice to remove the app');
      expect(notice?.text).toContain('Synthetic Practice');
    });

    it('ends the other sign-ins of the account, which have only the password', async () => {
      const who = await staff();
      const elsewhere = tokenOf(await login(who.email).expect(200));
      const { tokens } = await withSecondFactor(who);
      await as(request(server()).get(`${API}/me`), elsewhere).expect(401);
      await as(request(server()).get(`${API}/me`), tokens.accessToken).expect(200);
      const live = await platform().session.count({
        where: { userId: who.userId, revokedAt: null, rotatedAt: null },
      });
      expect(live).toBe(1);
    });

    it('gives a browser cookies and no tokens, which a script of the page could read', async () => {
      const who = await staff();
      const signedIn = await request(server())
        .post(`${API}/auth/login`)
        .set('X-Forwarded-For', client)
        .send({ email: who.email, password: PASSWORD })
        .expect(200);
      const cookies = (signedIn.headers['set-cookie'] ?? []) as unknown as string[];
      const header = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
      const csrf = /mb_csrf=([^;]+)/.exec(header)?.[1] ?? '';
      const asBrowser = (test: request.Test): request.Test =>
        test.set('X-Forwarded-For', client).set('Cookie', header).set('X-CSRF-Token', csrf);
      const started = await asBrowser(request(server()).post(`${API}/me/mfa/totp`)).expect(200);
      const { secret } = started.body as { secret: string };
      const confirmed = await asBrowser(request(server()).post(`${API}/me/mfa/totp/confirm`))
        .send({ code: codeAt(secret) })
        .expect(200);
      expect(confirmed.body).not.toHaveProperty('tokens');
      expect((confirmed.body as TotpEnabled).recoveryCodes).toHaveLength(10);
      const renewed = (confirmed.headers['set-cookie'] ?? []) as unknown as string[];
      expect(renewed.some((cookie) => cookie.startsWith('mb_refresh='))).toBe(true);
      const unknown = await asBrowser(request(server()).post(`${API}/me/mfa/totp/confirm`))
        .send({ code: '123456', delivery: 'body' })
        .expect(400);
      expect(codeOf(unknown.body)).toBe('VALIDATION_FAILED');
    });

    it('refuses a confirmation before any start, and a code of another secret', async () => {
      const who = await staff();
      const none = await confirmTotp(who.token, '123456').expect(400);
      expect(codeOf(none.body)).toBe('MFA_CODE_INVALID');
      await startTotp(who.token);
      const stranger = await confirmTotp(who.token, codeAt('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'));
      expect(stranger.status).toBe(400);
    });
  });

  describe('signing in with a second factor', () => {
    it('asks for the code after the right password, and opens no session without it', async () => {
      const who = await staff();
      const { secret } = await withSecondFactor(who);
      const withoutCode = await login(who.email).expect(401);
      expect(codeOf(withoutCode.body)).toBe('MFA_CODE_REQUIRED');
      expect(withoutCode.body).not.toHaveProperty('tokens');
      const wrongPassword = await login(who.email, { password: 'synthetic wrong one', code: '1' });
      expect(wrongPassword.status).toBe(401);
      expect(codeOf(wrongPassword.body)).toBe('INVALID_CREDENTIALS');
      const wrongCode = await login(who.email, { code: '000000' }).expect(400);
      expect(codeOf(wrongCode.body)).toBe('MFA_CODE_INVALID');
      nextStep();
      const code = codeAt(secret);
      const signedIn = await login(who.email, { code }).expect(200);
      // A session with both factors: the staff route lets it in.
      await membership(tokenOf(signedIn)).expect(200, { role: 'STAFF', providerId: null });
      const replayed = await login(who.email, { code }).expect(400);
      expect(codeOf(replayed.body)).toBe('MFA_CODE_INVALID');
      const user = await platform().user.findUniqueOrThrow({ where: { id: who.userId } });
      expect(user.failedLoginCount).toBe(1);
    });

    it('takes each recovery code once, written as shown or not', async () => {
      const who = await staff();
      const { recoveryCodes } = await withSecondFactor(who);
      const [first = '', second = ''] = recoveryCodes;
      await login(who.email, { recoveryCode: first }).expect(200);
      const spent = await login(who.email, { recoveryCode: first }).expect(400);
      expect(codeOf(spent.body)).toBe('MFA_CODE_INVALID');
      await login(who.email, { recoveryCode: ` ${second.toUpperCase().replace('-', '')} ` }).expect(
        200,
      );
      const audit = await withClient(databases.platformOwnerUrl, (owner) =>
        owner.query<{ action: string }>(
          "SELECT action FROM platform_audit_events WHERE actor = $1 AND action = 'auth.mfa.recovery'",
          [`user:${who.userId}`],
        ),
      );
      expect(audit.rows).toHaveLength(2);
    });

    it('keeps wrong codes counted across a new password, so the mailbox gives no new tries', async () => {
      const who = await staff();
      const { secret } = await withSecondFactor(who);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await login(who.email, { code: '000000' }).expect(400);
      }
      await request(server())
        .post(`${API}/auth/password/forgot`)
        .set('X-Forwarded-For', client)
        .send({ email: who.email })
        .expect(202);
      await request(server())
        .post(`${API}/auth/password/reset`)
        .set('X-Forwarded-For', client)
        .send({ token: await resetToken(who.email), password: NEW_PASSWORD })
        .expect(204);
      const user = await platform().user.findUniqueOrThrow({ where: { id: who.userId } });
      expect(user).toMatchObject({ failedLoginCount: 0, mfaFailedCount: 5 });
      nextStep();
      // The new password counts, the right code does not: the codes still wait.
      const waiting = await login(who.email, { password: NEW_PASSWORD, code: codeAt(secret) });
      expect(waiting.status).toBe(400);
      expect(codeOf(waiting.body)).toBe('MFA_CODE_INVALID');
      clock.set(clock.now().add({ minutes: 2 }));
      await login(who.email, { password: NEW_PASSWORD, code: codeAt(secret) }).expect(200);
      const after = await platform().user.findUniqueOrThrow({ where: { id: who.userId } });
      expect(after).toMatchObject({ mfaFailedCount: 0, mfaLockedUntil: null });
    });

    it('lets a password without its code count as a failure, so codes wait like passwords', async () => {
      const who = await staff();
      const { secret } = await withSecondFactor(who);
      for (let attempt = 0; attempt < 5; attempt += 1) await login(who.email).expect(401);
      nextStep();
      // The account waits now: even the right code gets the generic answer.
      const waiting = await login(who.email, { code: codeAt(secret) }).expect(401);
      expect(codeOf(waiting.body)).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('the role command and the staff routes', () => {
    it('makes an account the admin of the installation; its routes need both factors', async () => {
      const who = await person();
      expect(await roles().setRole(who.email, 'ADMIN', OPERATOR)).toEqual({
        result: 'SET',
        role: 'ADMIN',
        mfaEnabled: false,
      });
      const withPasswordOnly = await membership(who.token).expect(403);
      expect(codeOf(withPasswordOnly.body)).toBe('MFA_REQUIRED');
      const { tokens } = await withSecondFactor(who);
      const response = await membership(tokens.accessToken).expect(200);
      expect(response.body).toEqual({ role: 'ADMIN', providerId: null });
      await as(
        request(server()).get(`${API}/practices/${practice.practiceId}/probe/admin-only`),
        tokens.accessToken,
      ).expect(200);
      const index = await platform().practiceAccess.findMany({ where: { userId: who.userId } });
      expect(index).toEqual([
        expect.objectContaining({
          practiceId: practice.practiceId,
          capacity: 'STAFF',
          active: true,
        }),
      ]);
      const audit = await asOwner(practice, (owner) =>
        owner.query<{ actor: string; action: string }>(
          "SELECT actor, action FROM audit_events WHERE action = 'staff.role.set'",
        ),
      );
      expect(audit.rows).toContainEqual({
        actor: `operator:${OPERATOR}`,
        action: 'staff.role.set',
      });
    });

    it('answers 404 in another practice and for an unknown one, 403 for another role', async () => {
      const who = await person();
      await roles().setRole(who.email, 'STAFF', OPERATOR);
      const { tokens } = await withSecondFactor(who);
      await membership(tokens.accessToken).expect(200, { role: 'STAFF', providerId: null });
      await membership(tokens.accessToken, other.practiceId).expect(404);
      await membership(tokens.accessToken, '00000000-0000-4000-8000-000000000000').expect(404);
      await membership(tokens.accessToken, 'not-a-uuid').expect(404);
      const adminOnly = await as(
        request(server()).get(`${API}/practices/${practice.practiceId}/probe/admin-only`),
        tokens.accessToken,
      ).expect(403);
      expect(codeOf(adminOnly.body)).toBe('FORBIDDEN');
    });

    it('ends a membership on the next request, and the practice database overrules its index', async () => {
      const who = await person();
      await roles().setRole(who.email, 'DOCTOR', OPERATOR);
      const { tokens } = await withSecondFactor(who);
      await membership(tokens.accessToken).expect(200, { role: 'DOCTOR', providerId: null });
      // Disabled in the practice database only: the index row is still active, and does not count.
      await asOwner(practice, (owner) =>
        owner.query("UPDATE memberships SET status = 'DISABLED' WHERE user_id = $1", [who.userId]),
      );
      await membership(tokens.accessToken).expect(404);
      await roles().setRole(who.email, 'DOCTOR', OPERATOR);
      await membership(tokens.accessToken).expect(200);
      expect(await roles().setRole(who.email, null, OPERATOR)).toEqual({ result: 'REMOVED' });
      await membership(tokens.accessToken).expect(404);
      const [row] = await platform().practiceAccess.findMany({ where: { userId: who.userId } });
      expect(row?.active).toBe(false);
    });

    it('changes nothing for an unknown or unconfirmed account, or a removal of none', async () => {
      const unconfirmed = await person({ confirmed: false });
      const outsider = await person();
      expect(await roles().setRole('nobody@example.test', 'ADMIN', OPERATOR)).toEqual({
        result: 'ACCOUNT_NOT_FOUND',
      });
      expect(await roles().setRole(unconfirmed.email, 'ADMIN', OPERATOR)).toEqual({
        result: 'EMAIL_NOT_VERIFIED',
      });
      expect(await roles().setRole(outsider.email, null, OPERATOR)).toEqual({
        result: 'NOT_A_MEMBER',
      });
      const count = await asOwner(practice, (owner) =>
        owner.query('SELECT 1 FROM memberships WHERE user_id = ANY($1::uuid[])', [
          [unconfirmed.userId, outsider.userId],
        ]),
      );
      expect(count.rows).toHaveLength(0);
    });

    it('logs no code, secret or address', () => {
      const text = logs.text();
      expect(text).not.toMatch(/otpauth|recoveryCode|@example\.test/);
    });
  });
});

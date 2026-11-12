/**
 * Accounts, sessions and their e-mails against a real platform database (08 A01, A02, A03).
 */
import { randomUUID } from 'node:crypto';
import { PRIVACY_NOTICE_VERSION } from '@medibooker/i18n';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request, { type Response } from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformPrismaService } from '../../src/common/database/platform-prisma.service.js';
import { PlatformAudit } from '../../src/common/security/platform-audit.js';
import { FixedClock } from '../../src/common/time/fixed-clock.js';
import { SignInAttempts } from '../../src/modules/auth/sign-in-attempts.js';
import { AccountProfileService } from '../../src/modules/account-profile/account-profile.service.js';
import { UnconfirmedAccountsJob } from '../../src/modules/auth/unconfirmed-accounts.job.js';
import { AccountOutbox } from '../../src/modules/notifications/account-outbox.js';
import { type Email, EmailSender } from '../../src/modules/notifications/email-sender.js';
import { createTestApp } from '../support/create-test-app.js';
import { captureLogs } from '../support/log-capture.js';
import { usePracticeDatabases } from '../support/practices.js';
import { problemWithoutRequestId } from '../support/problem.js';

const AUTH = '/api/v1/auth';
const ME = '/api/v1/me';
const PROFILE = `${ME}/profile`;
const PASSWORD = 'synthetic correct horse battery';
const NEW_PASSWORD = 'another synthetic passphrase here';
/** On the bundled list of known passwords. */
const WELL_KNOWN = '1234567890';
const PRIVACY_NOTICE = PRIVACY_NOTICE_VERSION;
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const CONFIRMATION_SUBJECT = 'Please confirm your e-mail address';
const RESET_SUBJECT = 'Reset your password';
/** Much longer than a request takes here when nothing holds it up. */
const WAITS_FOR_A_LOCK_MS = 500;

interface Cookies {
  access: string;
  refresh: string;
  csrf: string;
}

/** The status of an answer, for a test to assert on. */
async function statusOf(test: request.Test): Promise<number> {
  return (await test).status;
}

function valuesOf({ access, refresh, csrf }: Cookies): readonly string[] {
  return [access, refresh, csrf];
}

function cookiesOf(response: Response): Cookies {
  const header = (response.headers['set-cookie'] ?? []) as unknown as string[];
  const value = (name: string): string =>
    header
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.split(';')[0]
      ?.slice(name.length + 1) ?? '';
  return { access: value('mb_access'), refresh: value('mb_refresh'), csrf: value('mb_csrf') };
}

describe('accounts on a real platform database', () => {
  const databases = usePracticeDatabases({ practices: 'none' });
  const clock = new FixedClock(NOW);
  const logs = captureLogs();
  const sent: Email[] = [];
  const sender = {
    send: vi.fn((email: Email) => {
      sent.push(email);
      return Promise.resolve();
    }),
  };
  /** Sends what a test left behind, so that no test finds the e-mails of another. */
  const drainOutbox = async (): Promise<void> => {
    sender.send.mockReset();
    await outbox().processDue();
    sent.length = 0;
  };
  let app: NestExpressApplication;
  let addresses = 0;
  let clients = 0;
  let client = '';

  const server = (): ReturnType<NestExpressApplication['getHttpServer']> => app.getHttpServer();
  const post = (path: string, body: object = {}): request.Test =>
    request(server()).post(`${AUTH}/${path}`).set('X-Forwarded-For', client).send(body);
  const newAddress = (): string => {
    addresses += 1;
    return `person-${String(addresses)}@example.test`;
  };
  const platform = (): PlatformPrismaService => app.get(PlatformPrismaService);
  const outbox = (): AccountOutbox => app.get(AccountOutbox);

  /** The token in the newest e-mail to this address, as the link gives it to the page. */
  const tokenInEmail = async (to: string, subject: string): Promise<string> => {
    await outbox().processDue();
    const email = sent.findLast(
      (candidate) => candidate.to === to && candidate.subject === subject,
    );
    return /#token=([\w-]+)/.exec(email?.text ?? '')?.[1] ?? '';
  };
  const confirmationToken = (to: string): Promise<string> => tokenInEmail(to, CONFIRMATION_SUBJECT);
  const resetToken = (to: string): Promise<string> => tokenInEmail(to, RESET_SUBJECT);

  const register = async (email = newAddress(), password = PASSWORD): Promise<string> => {
    await post('register', {
      email,
      password,
      locale: 'en',
      privacyNoticeVersion: PRIVACY_NOTICE,
    }).expect(202);
    return email;
  };

  const login = (email: string, password = PASSWORD): request.Test =>
    post('login', { email, password });

  const signedIn = async (): Promise<{ email: string; cookies: Cookies }> => {
    const email = await register();
    const response = await login(email).expect(200);
    return { email, cookies: cookiesOf(response) };
  };

  const getMe = (cookies: Cookies): request.Test =>
    request(server()).get(ME).set('Cookie', `mb_access=${cookies.access}`);

  const refresh = (cookies: Cookies): request.Test =>
    post('refresh')
      .set('Cookie', `mb_refresh=${cookies.refresh}`)
      .set('X-CSRF-Token', cookies.csrf);

  beforeAll(async () => {
    app = await createTestApp({
      // One proxy in front, so that each test is its own client with its own limits.
      env: { ...databases.apiEnv, TRUST_PROXY_HOPS: '1' },
      logDestination: logs,
      clock,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
  });

  beforeEach(() => {
    clients += 1;
    client = `198.51.100.${String(clients)}`;
    clock.set(NOW);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await drainOutbox();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('signing up (08 A03)', () => {
    it('sends a link that confirms the address once', async () => {
      const email = await register();
      const cookies = cookiesOf(await login(email).expect(200));
      const { id } = await platform().user.findUniqueOrThrow({ where: { email } });
      // Exactly these fields: nothing of the row reaches an answer by accident.
      expect((await getMe(cookies).expect(200)).body).toEqual({
        id,
        email,
        emailVerified: false,
        locale: 'en',
        mfaEnabled: false,
      });

      const token = await confirmationToken(email);
      await post('verify-email', { token, password: PASSWORD }).expect(204);
      expect((await getMe(cookies).expect(200)).body).toMatchObject({ emailVerified: true });

      const again = await post('verify-email', { token, password: PASSWORD }).expect(400);
      expect(again.body).toMatchObject({ code: 'INVALID_TOKEN' });
    });

    it('needs the password of the account, so a click alone confirms nothing', async () => {
      const email = await register();
      const token = await confirmationToken(email);
      const wrong = await post('verify-email', { token, password: NEW_PASSWORD }).expect(401);
      expect(wrong.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      const user = await platform().user.findUniqueOrThrow({ where: { email } });
      expect(user.emailVerifiedAt).toBeNull();
      // The link still works for whoever knows the password.
      expect(await statusOf(post('verify-email', { token, password: PASSWORD }))).toBe(204);
    });

    it('tells nothing about a password through a link that is over', async () => {
      const email = await register();
      const used = await confirmationToken(email);
      await post('verify-email', { token: used, password: PASSWORD }).expect(204);
      await post('password/forgot', { email }).expect(202);
      const reset = await resetToken(email);
      const expired = await confirmationToken(await register());
      clock.set(NOW.add({ minutes: 30 }));

      for (const token of [used, reset, expired]) {
        const right = await post('verify-email', { token, password: PASSWORD }).expect(400);
        const wrong = await post('verify-email', { token, password: NEW_PASSWORD }).expect(400);
        expect(problemWithoutRequestId(right)).toEqual(problemWithoutRequestId(wrong));
        expect(right.body).toMatchObject({ code: 'INVALID_TOKEN' });
      }
    });

    it('counts a wrong password at the confirmation like one at a sign-in', async () => {
      const email = await register();
      const token = await confirmationToken(email);
      for (let guess = 0; guess < 5; guess += 1) {
        await post('verify-email', { token, password: NEW_PASSWORD }).expect(401);
      }
      expect(await statusOf(post('verify-email', { token, password: PASSWORD }))).toBe(401);
      expect(await statusOf(login(email))).toBe(401);

      const { id } = await platform().user.findUniqueOrThrow({ where: { email } });
      const failed = await platform().platformAuditEvent.count({
        where: { actor: `user:${id}`, action: 'auth.email.verify', outcome: 'FAILED' },
      });
      expect(failed).toBe(6);

      clock.set(NOW.add({ minutes: 2 }));
      expect(await statusOf(post('verify-email', { token, password: PASSWORD }))).toBe(204);
      const user = await platform().user.findUniqueOrThrow({ where: { email } });
      expect(user).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
      expect(user.emailVerifiedAt).not.toBeNull();
    });

    it('takes only the current version of the privacy notice', async () => {
      const answer = await post('register', {
        email: newAddress(),
        password: PASSWORD,
        locale: 'en',
        privacyNoticeVersion: '2020-01',
      }).expect(400);
      expect(answer.body).toMatchObject({ errors: [{ field: 'privacyNoticeVersion' }] });
    });

    it('keeps what a person agreed to, with its version', async () => {
      const email = await register();
      const consents = await platform().accountConsent.findMany({
        where: { user: { email } },
      });
      expect(consents).toMatchObject([{ type: 'PRIVACY_NOTICE', textVersion: PRIVACY_NOTICE }]);
    });

    it('takes a token for 30 minutes and not a moment longer', async () => {
      const inTime = await confirmationToken(await register());
      const tooLate = await confirmationToken(await register());

      clock.set(NOW.add({ minutes: 29, seconds: 59 }));
      expect(await statusOf(post('verify-email', { token: inTime, password: PASSWORD }))).toBe(204);
      clock.set(NOW.add({ minutes: 30 }));
      expect(await statusOf(post('verify-email', { token: tooLate, password: PASSWORD }))).toBe(
        400,
      );
    });

    it('answers the same for a known and an unknown address', async () => {
      const known = await register();
      const unknown = 'nobody@example.test';
      const body = { password: PASSWORD, locale: 'en', privacyNoticeVersion: PRIVACY_NOTICE };

      const first = await post('register', { ...body, email: known }).expect(202);
      const second = await post('register', { ...body, email: newAddress() }).expect(202);
      expect(first.body).toEqual(second.body);

      const forgotKnown = await post('password/forgot', { email: known }).expect(202);
      const forgotUnknown = await post('password/forgot', { email: unknown }).expect(202);
      expect(forgotKnown.body).toEqual(forgotUnknown.body);

      const resendKnown = await post('verify-email/resend', { email: known }).expect(202);
      const resendUnknown = await post('verify-email/resend', { email: unknown }).expect(202);
      expect(resendKnown.body).toEqual(resendUnknown.body);
    });

    it('does not take over an account that exists', async () => {
      const email = await register();
      await register(email, NEW_PASSWORD);
      expect(await statusOf(login(email, NEW_PASSWORD))).toBe(401);
      expect(await statusOf(login(email))).toBe(200);
    });

    it('treats an address the same in any case', async () => {
      const email = await register();
      await register(email.toUpperCase(), NEW_PASSWORD);
      expect(await statusOf(login(email.toUpperCase()))).toBe(200);
      expect(await statusOf(login(email, NEW_PASSWORD))).toBe(401);
    });

    it('refuses a look-alike of an address, which the column would take for the same', async () => {
      const body = { password: PASSWORD, locale: 'en', privacyNoticeVersion: PRIVACY_NOTICE };
      const answer = await post('register', { ...body, email: 'ki\u212A@example.test' }).expect(
        400,
      );
      expect(answer.body).toMatchObject({ errors: [{ field: 'email', code: 'INVALID_FORMAT' }] });
    });

    it('refuses a short or a well-known password, and names the field', async () => {
      const body = { email: newAddress(), locale: 'en', privacyNoticeVersion: PRIVACY_NOTICE };
      const short = await post('register', { ...body, password: 'too short' }).expect(400);
      expect(short.body).toMatchObject({ errors: [{ field: 'password', code: 'TOO_SHORT' }] });
      const known = await post('register', { ...body, password: WELL_KNOWN }).expect(400);
      expect(known.body).toMatchObject({
        errors: [{ field: 'password', code: 'PASSWORD_BREACHED' }],
      });
    });

    it('leaves neither an account nor an e-mail when its transaction fails', async () => {
      const email = newAddress();
      vi.spyOn(app.get(PlatformAudit), 'record').mockRejectedValueOnce(new Error('refused'));
      await post('register', {
        email,
        password: PASSWORD,
        locale: 'en',
        privacyNoticeVersion: PRIVACY_NOTICE,
      }).expect(500);
      expect(await platform().user.count({ where: { email } })).toBe(0);
      expect(await platform().accountNotification.count({ where: { user: { email } } })).toBe(0);
    });
  });

  describe('signing in (08 A01)', () => {
    it('sets cookies a script cannot read and another site cannot send', async () => {
      const response = await login(await register()).expect(200);
      const cookies = response.headers['set-cookie'] as unknown as string[];
      // Access, refresh and CSRF, and the browser's device cookie (A04, E10).
      expect(cookies).toHaveLength(4);
      for (const cookie of cookies) {
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('SameSite=Strict');
      }
      expect(cookies.filter((cookie) => cookie.includes('HttpOnly'))).toHaveLength(3);
      const device = cookies.find((cookie) => cookie.startsWith('__Secure-mb_device='));
      expect(device).toContain('Path=/api/v1/auth;');
      expect(device).toContain('HttpOnly');
      expect(response.body).not.toHaveProperty('tokens');
      expect(JSON.stringify(response.body)).not.toContain('password');
    });

    it('gives one answer for a wrong password and an unknown address', async () => {
      const wrong = await login(await register(), NEW_PASSWORD).expect(401);
      const unknown = await login('nobody@example.test').expect(401);
      expect(problemWithoutRequestId(wrong)).toEqual(problemWithoutRequestId(unknown));
      expect(wrong.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('lets an address sign in before it is confirmed, which is the accepted risk RT-89', async () => {
      const taken = await register();
      const free = newAddress();
      await register(taken, NEW_PASSWORD);
      await register(free, NEW_PASSWORD);
      expect(await statusOf(login(taken, NEW_PASSWORD))).toBe(401);
      const onFree = await login(free, NEW_PASSWORD).expect(200);
      expect(onFree.body).toMatchObject({ account: { emailVerified: false } });
    });

    it('starts no session on a password that a reset has just replaced', async () => {
      const email = await register();
      await post('password/forgot', { email }).expect(202);
      const token = await resetToken(email);
      const attempts = app.get(SignInAttempts);
      const count = attempts.count.bind(attempts);
      vi.spyOn(attempts, 'count').mockImplementationOnce(async (address) => {
        const attempt = await count(address);
        await post('password/reset', { token, password: NEW_PASSWORD }).expect(204);
        return attempt;
      });

      expect(await statusOf(login(email))).toBe(401);
      expect(await platform().session.count({ where: { user: { email }, revokedAt: null } })).toBe(
        0,
      );
    });

    it('lets at most five of a burst of guesses past the wait', async () => {
      const email = await register();
      const answers = await Promise.all(
        Array.from({ length: 10 }, () => login(email, NEW_PASSWORD)),
      );
      expect(answers.map(({ status }) => status)).toEqual(Array.from({ length: 10 }, () => 401));
      const user = await platform().user.findUniqueOrThrow({ where: { email } });
      expect(user.failedLoginCount).toBe(5);
      expect(user.lockedUntil).toEqual(new Date(NOW.add({ minutes: 1 }).epochMilliseconds));
    });

    it('makes an account wait after five failures, with the same answer, and then lets it in', async () => {
      const email = await register();
      for (let failure = 0; failure < 5; failure += 1) await login(email, NEW_PASSWORD).expect(401);

      const right = await login(email).expect(401);
      expect(right.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });

      clock.set(NOW.add({ minutes: 2 }));
      await login(email).expect(200);
      const user = await platform().user.findUniqueOrThrow({ where: { email } });
      expect(user).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
    });

    it('answers 429 after the limit of a client', async () => {
      let status = 0;
      for (let attempt = 0; attempt <= 10; attempt += 1) {
        ({ status } = await login('nobody@example.test'));
      }
      expect(status).toBe(429);
    });

    it('answers 429 after five sign-ups of a client', async () => {
      const body = { password: PASSWORD, locale: 'en', privacyNoticeVersion: PRIVACY_NOTICE };
      let status = 0;
      for (let attempt = 0; attempt <= 5; attempt += 1) {
        ({ status } = await post('register', { ...body, email: newAddress() }));
      }
      expect(status).toBe(429);
    });

    it('gives the app its tokens in the answer, for a Bearer header without CSRF', async () => {
      const email = await register();
      const response = await post('login', {
        email,
        password: PASSWORD,
        delivery: 'body',
      }).expect(200);
      expect(response.headers['set-cookie']).toBeUndefined();
      const { tokens } = response.body as {
        tokens: { accessToken: string; refreshToken: string; expiresInSeconds: number };
      };
      expect(tokens.expiresInSeconds).toBe(900);
      await request(server())
        .patch(ME)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ locale: 'ar' })
        .expect(200);

      const refreshed = await post('refresh', { refreshToken: tokens.refreshToken }).expect(200);
      expect(refreshed.body).toHaveProperty('tokens.accessToken');
    });
  });

  describe('the guard (08 A01)', () => {
    it('answers 401 without credentials and for a token that is not ours', async () => {
      const me = (): request.Test => request(server()).get(ME);
      expect(await statusOf(me())).toBe(401);
      expect(await statusOf(me().set('Authorization', 'Bearer not.a.token'))).toBe(401);
      expect(await statusOf(me().set('Cookie', 'mb_access=not.a.token'))).toBe(401);
    });

    it('answers 401 once the access token is over, after 15 minutes', async () => {
      const { cookies } = await signedIn();
      clock.set(NOW.add({ minutes: 14, seconds: 59 }));
      expect(await statusOf(getMe(cookies))).toBe(200);
      clock.set(NOW.add({ minutes: 15 }));
      expect(await statusOf(getMe(cookies))).toBe(401);
    });

    it('needs the CSRF header on an unsafe cookie request, and only its own', async () => {
      const { cookies } = await signedIn();
      const other = await signedIn();
      const patch = (): request.Test =>
        request(server())
          .patch(ME)
          .set('Cookie', `mb_access=${cookies.access}`)
          .send({ locale: 'ar' });

      await patch().expect(403);
      await patch().set('X-CSRF-Token', 'wrong').expect(403);
      await patch().set('X-CSRF-Token', other.cookies.csrf).expect(403);
      const response = await patch().set('X-CSRF-Token', cookies.csrf).expect(200);
      expect(response.body).toMatchObject({ locale: 'ar' });
    });

    it('takes a user from the token only: a body cannot name another', async () => {
      const { cookies } = await signedIn();
      const answer = await request(server())
        .patch(ME)
        .set('Cookie', `mb_access=${cookies.access}`)
        .set('X-CSRF-Token', cookies.csrf)
        .send({ locale: 'ar', id: '00000000-0000-4000-8000-000000000000' });
      expect(answer.status).toBe(400);
    });
  });

  describe('refresh tokens (08 A01)', () => {
    it('needs the CSRF header with a cookie', async () => {
      const { cookies } = await signedIn();
      expect(await statusOf(post('refresh').set('Cookie', `mb_refresh=${cookies.refresh}`))).toBe(
        403,
      );
    });

    it('gives new tokens and stores none of them', async () => {
      const { email, cookies } = await signedIn();
      const next = cookiesOf(await refresh(cookies).expect(200));
      expect(next.refresh).not.toBe(cookies.refresh);
      await getMe(next).expect(200);
      const sessions = await platform().session.findMany({ where: { user: { email } } });
      expect(sessions).toHaveLength(2);
      for (const session of sessions) {
        expect(session.tokenHash).not.toBe(cookies.refresh);
        expect(session.tokenHash).not.toBe(next.refresh);
      }
    });

    it('revokes the whole family when an old token comes back', async () => {
      const { email, cookies } = await signedIn();
      const next = cookiesOf(await refresh(cookies).expect(200));

      clock.set(NOW.add({ seconds: 11 }));
      await refresh(cookies).expect(401);

      await getMe(next).expect(401);
      await refresh(next).expect(401);
      const sessions = await platform().session.findMany({ where: { user: { email } } });
      expect(sessions.every(({ revokedAt }) => revokedAt !== null)).toBe(true);
    });

    it('takes a second request within seconds for a race, and keeps the sign-in', async () => {
      const { cookies } = await signedIn();
      const next = cookiesOf(await refresh(cookies).expect(200));
      clock.set(NOW.add({ seconds: 10 }));
      expect(await statusOf(refresh(cookies))).toBe(401);
      expect(await statusOf(getMe(next))).toBe(200);
      expect(await statusOf(refresh(next))).toBe(200);
    });

    it('rotates once when two requests come at the same moment', async () => {
      const { cookies } = await signedIn();
      const answers = await Promise.all([refresh(cookies), refresh(cookies), refresh(cookies)]);
      expect(answers.map(({ status }) => status).sort()).toEqual([200, 401, 401]);
    });

    it('rejects one that is over', async () => {
      const { cookies } = await signedIn();
      clock.set(NOW.add({ hours: 30 * 24 }));
      expect(await statusOf(refresh(cookies))).toBe(401);
    });
  });

  describe('signing out (08 A01)', () => {
    it('ends the sign-in at once, and clears the cookies', async () => {
      const { cookies } = await signedIn();
      const response = await post('logout')
        .set('Cookie', `mb_refresh=${cookies.refresh}`)
        .set('X-CSRF-Token', cookies.csrf)
        .expect(204);
      const cleared = response.headers['set-cookie'] as unknown as string[];
      expect(cleared.every((cookie) => cookie.includes('Max-Age=0'))).toBe(true);
      await getMe(cookies).expect(401);
      await refresh(cookies).expect(401);
    });

    it('needs the CSRF header with a cookie, so no other site can sign someone out', async () => {
      const { cookies } = await signedIn();
      expect(await statusOf(post('logout').set('Cookie', `mb_refresh=${cookies.refresh}`))).toBe(
        403,
      );
      expect(await statusOf(getMe(cookies))).toBe(200);
    });

    it('is fine without a sign-in', async () => {
      expect(await statusOf(post('logout'))).toBe(204);
      expect(await statusOf(post('logout', { refreshToken: 'unknown' }))).toBe(204);
    });

    it('clears no cookie for a request without one, as from another site', async () => {
      const answer = await post('logout').expect(204);
      expect(answer.headers['set-cookie']).toBeUndefined();
    });

    /** Holds a transaction open on the person's row, with what `during` does in it. */
    const holdingTheRow = async (
      userId: string,
      during: (
        tx: Parameters<Parameters<PlatformPrismaService['$transaction']>[0]>[0],
      ) => Promise<unknown>,
    ): Promise<{ readonly release: () => Promise<void> }> => {
      const held = Promise.withResolvers<undefined>();
      const release = Promise.withResolvers<undefined>();
      const transaction = platform().$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
          await during(tx);
          held.resolve(undefined);
          await release.promise;
        },
        { timeout: 30_000 },
      );
      await held.promise;
      return {
        release: async () => {
          release.resolve(undefined);
          await transaction;
        },
      };
    };

    /** Whether a request is still waiting after a moment in which it would otherwise have answered. */
    const isWaiting = async (answer: Promise<unknown>): Promise<boolean> => {
      const moment = new Promise<'waiting'>((resolve) => {
        setTimeout(() => {
          resolve('waiting');
        }, WAITS_FOR_A_LOCK_MS);
      });
      return (await Promise.race([answer, moment])) === 'waiting';
    };

    it('waits for a refresh under way, and also ends the session it is making', async () => {
      const { email, cookies } = await signedIn();
      const { userId, familyId, amr, expiresAt } = await platform().session.findFirstOrThrow({
        where: { user: { email } },
      });
      const nextId = randomUUID();
      // What a refresh does in its transaction, stopped just before its commit.
      const { release } = await holdingTheRow(userId, (tx) =>
        tx.session.create({
          data: { id: nextId, userId, familyId, tokenHash: `next-${nextId}`, amr, expiresAt },
        }),
      );

      const answer = post('logout')
        .set('Cookie', `mb_refresh=${cookies.refresh}`)
        .set('X-CSRF-Token', cookies.csrf)
        .then(({ status }) => status);
      expect(await isWaiting(answer)).toBe(true);

      await release();
      await expect(answer).resolves.toBe(204);
      const made = await platform().session.findUniqueOrThrow({ where: { id: nextId } });
      expect(made.revokedAt).not.toBeNull();
    });

    it('a refresh waits at the same row, so that a sign-out cannot miss what it makes', async () => {
      const { email, cookies } = await signedIn();
      const { userId } = await platform().session.findFirstOrThrow({
        where: { user: { email } },
      });
      const { release } = await holdingTheRow(userId, () => Promise.resolve());

      const answer = refresh(cookies).then(({ status }) => status);
      expect(await isWaiting(answer)).toBe(true);

      await release();
      await expect(answer).resolves.toBe(200);
    });
  });

  describe('a forgotten password (08 A03)', () => {
    it('sets a new password once, and ends every session', async () => {
      const { email, cookies } = await signedIn();
      await post('password/forgot', { email }).expect(202);
      const token = await resetToken(email);

      await post('password/reset', { token, password: NEW_PASSWORD }).expect(204);

      expect(await statusOf(getMe(cookies))).toBe(401);
      expect(await statusOf(refresh(cookies))).toBe(401);
      expect(await statusOf(login(email))).toBe(401);
      expect(await statusOf(login(email, NEW_PASSWORD))).toBe(200);
      expect(await statusOf(post('password/reset', { token, password: PASSWORD }))).toBe(400);
    });

    it('confirms the address too, because its link reached the mailbox', async () => {
      const email = await register();
      await post('password/forgot', { email }).expect(202);
      const token = await resetToken(email);
      await post('password/reset', { token, password: NEW_PASSWORD }).expect(204);
      const answer = await login(email, NEW_PASSWORD).expect(200);
      expect(answer.body).toMatchObject({ account: { emailVerified: true } });
    });

    it('ends the other links to choose a password', async () => {
      const email = await register();
      await post('password/forgot', { email }).expect(202);
      const first = await resetToken(email);
      await post('password/forgot', { email }).expect(202);
      const second = await resetToken(email);
      expect(second).not.toBe(first);
      await post('password/reset', { token: second, password: NEW_PASSWORD }).expect(204);
      expect(await statusOf(post('password/reset', { token: first, password: PASSWORD }))).toBe(
        400,
      );
    });

    it('sends at most three links an hour while one works, and one when none does', async () => {
      const email = await register();
      const links = async (): Promise<number> => {
        await outbox().processDue();
        return sent.filter(({ to, subject }) => to === email && subject === RESET_SUBJECT).length;
      };
      for (let request = 0; request < 3; request += 1) {
        await post('password/forgot', { email }).expect(202);
      }
      expect(await links()).toBe(3);

      clock.set(NOW.add({ minutes: 29 }));
      await post('password/forgot', { email }).expect(202);
      expect(await links()).toBe(3);

      // All of them are over: a stranger who asked three times must not leave the owner without one.
      clock.set(NOW.add({ minutes: 31 }));
      await post('password/forgot', { email }).expect(202);
      expect(await links()).toBe(4);
    });

    it('keeps the limit for requests at the same moment', async () => {
      const email = await register();
      await Promise.all(
        Array.from({ length: 5 }, () => post('password/forgot', { email }).expect(202)),
      );
      await outbox().processDue();
      const links = sent.filter(({ to, subject }) => to === email && subject === RESET_SUBJECT);
      expect(links).toHaveLength(3);
    });

    it('does not take a confirmation token for a reset, or the other way round', async () => {
      const email = await register();
      const confirmation = await confirmationToken(email);
      expect(
        await statusOf(post('password/reset', { token: confirmation, password: NEW_PASSWORD })),
      ).toBe(400);

      await post('verify-email', { token: confirmation, password: PASSWORD }).expect(204);
      await post('password/forgot', { email }).expect(202);
      const reset = await resetToken(email);
      expect(await statusOf(post('verify-email', { token: reset, password: PASSWORD }))).toBe(400);
    });

    it('refuses a well-known new password and keeps the token usable', async () => {
      const email = await register();
      await post('password/forgot', { email }).expect(202);
      const token = await resetToken(email);
      expect(await statusOf(post('password/reset', { token, password: WELL_KNOWN }))).toBe(400);
      expect(await statusOf(post('password/reset', { token, password: NEW_PASSWORD }))).toBe(204);
    });
  });

  describe('the outbox of account e-mails (08 A02)', () => {
    const deliveryOf = async (email: string): Promise<{ status: string; attempts: number }> => {
      const [row] = await platform().accountNotification.findMany({
        where: { user: { email } },
        orderBy: { createdAt: 'desc' },
      });
      return { status: row?.status ?? '', attempts: row?.attempts ?? 0 };
    };

    it('holds no token and no text, and sends once even when two runs meet', async () => {
      const email = await register();
      const [row] = await platform().accountNotification.findMany({ where: { user: { email } } });
      expect(Object.keys(row ?? {})).not.toContain('text');
      await Promise.all([outbox().processDue(), outbox().processDue()]);
      expect(sent.filter(({ to }) => to === email)).toHaveLength(1);
      expect(await deliveryOf(email)).toEqual({ status: 'SENT', attempts: 1 });
    });

    it('queues one e-mail per reason', async () => {
      const email = await register();
      const [row] = await platform().accountNotification.findMany({ where: { user: { email } } });
      await expect(
        platform().accountNotification.create({
          data: {
            userId: row?.userId ?? '',
            template: 'EMAIL_VERIFICATION',
            dedupeKey: row?.dedupeKey ?? '',
            nextAttemptAt: new Date(NOW.epochMilliseconds),
          },
        }),
      ).rejects.toThrow();
    });

    it('retries with growing waits, and gives up after five attempts', async () => {
      const email = await register();
      sender.send.mockRejectedValue(new Error('server away'));
      await outbox().processDue();
      expect((await deliveryOf(email)).attempts).toBe(1);

      let due = NOW;
      for (const [attempt, wait] of [1, 2, 4, 8].entries()) {
        due = due.add({ minutes: wait });
        // A second before its next attempt nothing happens.
        clock.set(due.subtract({ seconds: 1 }));
        await outbox().processDue();
        expect((await deliveryOf(email)).attempts).toBe(attempt + 1);
        clock.set(due);
        await outbox().processDue();
        expect((await deliveryOf(email)).attempts).toBe(attempt + 2);
      }
      expect(await deliveryOf(email)).toEqual({ status: 'FAILED', attempts: 5 });
    });

    it('takes it calmly when an account goes while its e-mail is leaving', async () => {
      const email = await register();
      const other = await register();
      sender.send.mockImplementationOnce(async () => {
        await platform().user.deleteMany({ where: { email } });
        await platform().user.deleteMany({ where: { email: other } });
      });
      await expect(outbox().processDue()).resolves.toBeDefined();
      expect(await platform().accountNotification.count({ where: { user: { email } } })).toBe(0);
    });

    it('does not send a link that cannot work any more', async () => {
      const email = await register();
      clock.set(NOW.add({ minutes: 31 }));
      await outbox().processDue();
      expect(sent.filter(({ to }) => to === email)).toEqual([]);
      expect((await deliveryOf(email)).status).toBe('FAILED');
    });

    it('builds a link from its configuration and not from a request', async () => {
      const email = newAddress();
      await post('register', {
        email,
        password: PASSWORD,
        locale: 'en',
        privacyNoticeVersion: PRIVACY_NOTICE,
      })
        .set('Host', 'evil.example')
        .set('X-Forwarded-Host', 'evil.example')
        .expect(202);
      await outbox().processDue();
      const [message] = sent.filter(({ to }) => to === email);
      expect(message?.text).toContain('http://localhost:3000/en/verify-email#token=');
      expect(`${message?.text ?? ''}${message?.html ?? ''}`).not.toContain('evil.example');
    });

    it('writes in the language of the account, right to left for Arabic', async () => {
      const email = newAddress();
      await post('register', {
        email,
        password: PASSWORD,
        locale: 'ar',
        privacyNoticeVersion: PRIVACY_NOTICE,
      }).expect(202);
      await outbox().processDue();
      const [message] = sent.filter(({ to }) => to === email);
      expect(message?.html).toContain('<html lang="ar" dir="rtl">');
      expect(message?.text).toContain('http://localhost:3000/ar/verify-email#token=');
    });
  });

  describe('the details of an account (D16)', () => {
    const DETAILS = {
      firstName: 'Saralina',
      lastName: 'Ahmed',
      dateOfBirth: '1990-05-14',
      phone: '012 555 0161',
      insuranceType: 'PUBLIC',
      insuranceProvider: 'Al Noor Insurance',
      insuranceNumber: 'AN-4821-77',
    };
    const profile = (cookies: Cookies): request.Test =>
      request(server()).get(PROFILE).set('Cookie', `mb_access=${cookies.access}`);
    const save = (cookies: Cookies, body: object): request.Test =>
      request(server())
        .put(PROFILE)
        .set('Cookie', `mb_access=${cookies.access}`)
        .set('X-CSRF-Token', cookies.csrf)
        .send(body);

    it('keeps them, and never gives the insurance number back', async () => {
      const { email, cookies } = await signedIn();
      expect(await statusOf(profile(cookies))).toBe(404);

      const saved = await save(cookies, DETAILS).expect(200);
      const expected = {
        firstName: 'Saralina',
        lastName: 'Ahmed',
        dateOfBirth: '1990-05-14',
        phone: '012 555 0161',
        insuranceType: 'PUBLIC',
        insuranceProvider: 'Al Noor Insurance',
        insuranceNumberEnd: '2177',
      };
      expect(saved.body).toEqual(expected);
      expect((await profile(cookies).expect(200)).body).toEqual(expected);

      const { id } = await platform().user.findUniqueOrThrow({ where: { email } });
      const row = await platform().accountProfile.findUniqueOrThrow({ where: { userId: id } });
      expect(row.insuranceNumberEncrypted).not.toContain('4821');
    });

    it('asks a self-payer for nothing, and keeps nothing of an insurance before', async () => {
      const { cookies } = await signedIn();
      await save(cookies, DETAILS).expect(200);
      const saved = await save(cookies, {
        firstName: 'Saralina',
        lastName: 'Ahmed',
        dateOfBirth: '1990-05-14',
        insuranceType: 'SELF_PAY',
      }).expect(200);
      expect(saved.body).toMatchObject({
        phone: null,
        insuranceProvider: null,
        insuranceNumberEnd: null,
      });
    });

    it('keeps a known number when a person changes something else', async () => {
      const { cookies } = await signedIn();
      await save(cookies, DETAILS).expect(200);
      const saved = await save(cookies, {
        ...DETAILS,
        insuranceNumber: undefined,
        firstName: 'Salma',
      }).expect(200);
      expect(saved.body).toMatchObject({ firstName: 'Salma', insuranceNumberEnd: '2177' });
    });

    it('says which field is wrong', async () => {
      const { cookies } = await signedIn();
      const cases: readonly [object, string][] = [
        [{ ...DETAILS, firstName: '' }, 'firstName'],
        [{ ...DETAILS, dateOfBirth: '14.05.1990' }, 'dateOfBirth'],
        [{ ...DETAILS, dateOfBirth: '2026-02-31' }, 'dateOfBirth'],
        [{ ...DETAILS, dateOfBirth: '2030-01-01' }, 'dateOfBirth'],
        [{ ...DETAILS, phone: 'call me' }, 'phone'],
        [{ ...DETAILS, insuranceType: 'OTHER' }, 'insuranceType'],
        [{ ...DETAILS, insuranceProvider: undefined }, 'insuranceProvider'],
        [{ ...DETAILS, insuranceNumber: undefined }, 'insuranceNumber'],
        [{ ...DETAILS, insuranceNumber: '<script>' }, 'insuranceNumber'],
        [{ ...DETAILS, insuranceNumber: null }, 'insuranceNumber'],
        [{ ...DETAILS, insuranceNumber: '12' }, 'insuranceNumber'],
        [{ ...DETAILS, insuranceNumber: '      ' }, 'insuranceNumber'],
        [{ ...DETAILS, firstName: '   ' }, 'firstName'],
        [{ ...DETAILS, lastName: 'a\u0000b' }, 'lastName'],
        [{ ...DETAILS, lastName: 'a\nb' }, 'lastName'],
        [{ ...DETAILS, firstName: '\u202Eabc' }, 'firstName'],
        [{ ...DETAILS, insuranceProvider: 'a\u0000b' }, 'insuranceProvider'],
        [{ ...DETAILS, phone: '((((((' }, 'phone'],
      ];
      for (const [body, field] of cases) {
        const answer = await save(cookies, body).expect(400);
        const { errors } = answer.body as { errors: readonly { field: string }[] };
        expect(new Set(errors.map((error) => error.field))).toEqual(new Set([field]));
      }
    });

    it('takes digits of any script, as a keyboard types them', async () => {
      const { cookies } = await signedIn();
      expect(await statusOf(save(cookies, { ...DETAILS, phone: '٠١٢ ٥٥٥ ٠١٦١' }))).toBe(200);
    });

    it('needs the CSRF header, and writes only for the signed-in person', async () => {
      const { cookies } = await signedIn();
      const noHeader = request(server())
        .put(PROFILE)
        .set('Cookie', `mb_access=${cookies.access}`)
        .send(DETAILS);
      expect(await statusOf(noHeader)).toBe(403);
      expect(await statusOf(save(cookies, { ...DETAILS, userId: 'someone' }))).toBe(400);
    });

    it('writes nothing for a session that a reset has just ended', async () => {
      const { email, cookies } = await signedIn();
      const { id } = await platform().user.findUniqueOrThrow({ where: { email } });
      const [session] = await platform().session.findMany({ where: { userId: id } });
      await platform().session.updateMany({
        where: { userId: id },
        data: { revokedAt: new Date(NOW.epochMilliseconds) },
      });
      const actor = { userId: id, sessionId: session?.id ?? '', amr: ['pwd'] };
      await expect(
        app.get(AccountProfileService).save(actor, DETAILS as never),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(await platform().accountProfile.count({ where: { userId: id } })).toBe(0);
      expect(await statusOf(save(cookies, DETAILS))).toBe(401);
    });

    it('puts no field of them into an e-mail', async () => {
      const { email, cookies } = await signedIn();
      await save(cookies, DETAILS).expect(200);
      await post('verify-email/resend', { email }).expect(202);
      await outbox().processDue();
      const messages = sent.filter(({ to }) => to === email);
      expect(messages.length).toBeGreaterThan(0);
      for (const { subject, text, html } of messages) {
        const body = `${subject}${text}${html}`;
        // Whole values: a token is random text and may hold any short piece.
        for (const value of [
          'Saralina',
          'Ahmed',
          '1990-05-14',
          '012 555 0161',
          'Al Noor Insurance',
        ]) {
          expect(body).not.toContain(value);
        }
      }
    });

    it('hold nothing of them in the logs', async () => {
      const { cookies } = await signedIn();
      await save(cookies, DETAILS).expect(200);
      await profile(cookies).expect(200);
      const details = [
        'Saralina',
        'Ahmed',
        '1990-05-14',
        '012 555 0161',
        'Al Noor Insurance',
        'AN-4821-77',
      ];
      for (const value of details) expect(logs.text()).not.toContain(value);
    });

    describe('an account never confirmed', () => {
      it('starts anew at a reset, because its mailbox was shown only now', async () => {
        const { email, cookies } = await signedIn();
        await save(cookies, DETAILS).expect(200);
        const before = await platform().user.findUniqueOrThrow({ where: { email } });
        await post('password/forgot', { email }).expect(202);
        await post('password/reset', {
          token: await resetToken(email),
          password: NEW_PASSWORD,
        }).expect(204);

        const after = await platform().user.findUniqueOrThrow({ where: { email } });
        expect(after.id).not.toBe(before.id);
        expect(after.emailVerifiedAt).not.toBeNull();
        expect(await platform().accountProfile.count({ where: { userId: before.id } })).toBe(0);
        expect(await platform().accountConsent.count({ where: { userId: after.id } })).toBe(0);
        expect(await statusOf(getMe(cookies))).toBe(401);

        const owner = cookiesOf(await login(email, NEW_PASSWORD).expect(200));
        expect(await statusOf(profile(owner))).toBe(404);
      });

      it('keeps its details at the reset of an account that was confirmed', async () => {
        const email = await register();
        await post('verify-email', {
          token: await confirmationToken(email),
          password: PASSWORD,
        }).expect(204);
        const cookies = cookiesOf(await login(email).expect(200));
        await save(cookies, DETAILS).expect(200);
        await post('password/forgot', { email }).expect(202);
        await post('password/reset', {
          token: await resetToken(email),
          password: NEW_PASSWORD,
        }).expect(204);
        const owner = cookiesOf(await login(email, NEW_PASSWORD).expect(200));
        expect((await profile(owner).expect(200)).body).toMatchObject({ firstName: 'Saralina' });
      });

      it('goes after 7 days with its details, and a confirmed one stays', async () => {
        const job = app.get(UnconfirmedAccountsJob);
        const { email: unconfirmed, cookies } = await signedIn();
        await save(cookies, DETAILS).expect(200);
        const confirmed = await register();
        await post('verify-email', {
          token: await confirmationToken(confirmed),
          password: PASSWORD,
        }).expect(204);

        clock.set(NOW.add({ hours: 7 * 24 }));
        await job.run();
        expect(await platform().user.count({ where: { email: unconfirmed } })).toBe(1);

        clock.set(NOW.add({ hours: 7 * 24, minutes: 1 }));
        await job.run();
        expect(await platform().user.count({ where: { email: unconfirmed } })).toBe(0);
        expect(await platform().user.count({ where: { email: confirmed } })).toBe(1);
      });

      it('goes in batches, so a big backlog does not stop the deletion', async () => {
        const job = app.get(UnconfirmedAccountsJob);
        const created = new Date(NOW.subtract({ hours: 8 * 24 }).epochMilliseconds);
        const prefix = `backlog-${String(addresses)}`;
        await platform().user.createMany({
          data: Array.from({ length: 501 }, (_, index) => ({
            email: `${prefix}-${String(index)}@example.test`,
            passwordHash: 'synthetic',
            locale: 'en',
            createdAt: created,
          })),
        });
        await job.run();
        const left = await platform().user.count({ where: { email: { startsWith: prefix } } });
        expect(left).toBe(0);
      });

      it('can be deleted by who mistyped the address', async () => {
        const { email, cookies } = await signedIn();
        await save(cookies, DETAILS).expect(200);
        const remove = (): request.Test =>
          request(server())
            .delete(`${ME}/unconfirmed`)
            .set('Cookie', `mb_access=${cookies.access}`)
            .set('X-CSRF-Token', cookies.csrf);
        const answer = await remove().expect(204);
        const cleared = answer.headers['set-cookie'] as unknown as string[];
        expect(cleared.every((cookie) => cookie.includes('Max-Age=0'))).toBe(true);
        expect(await platform().user.count({ where: { email } })).toBe(0);
        expect(await statusOf(remove())).toBe(401);
      });

      it('is the only one this way can delete', async () => {
        const email = await register();
        await post('verify-email', {
          token: await confirmationToken(email),
          password: PASSWORD,
        }).expect(204);
        const cookies = cookiesOf(await login(email).expect(200));
        const answer = await request(server())
          .delete(`${ME}/unconfirmed`)
          .set('Cookie', `mb_access=${cookies.access}`)
          .set('X-CSRF-Token', cookies.csrf)
          .expect(409);
        expect(answer.body).toMatchObject({ code: 'CONFLICT' });
        expect(await platform().user.count({ where: { email } })).toBe(1);
      });

      it('takes the CSRF header too', async () => {
        const { email, cookies } = await signedIn();
        const answer = request(server())
          .delete(`${ME}/unconfirmed`)
          .set('Cookie', `mb_access=${cookies.access}`);
        expect(await statusOf(answer)).toBe(403);
        expect(await platform().user.count({ where: { email } })).toBe(1);
      });
    });
  });

  describe('the logs (02 §8)', () => {
    it('hold no address, password or token of a whole journey', async () => {
      const email = await register();
      const confirmation = await confirmationToken(email);
      await post('verify-email', { token: confirmation, password: PASSWORD }).expect(204);
      const cookies = cookiesOf(await login(email).expect(200));
      const next = cookiesOf(await refresh(cookies).expect(200));
      await post('password/forgot', { email }).expect(202);
      const reset = await resetToken(email);
      await post('password/reset', { token: reset, password: NEW_PASSWORD }).expect(204);
      await login(email, 'a wrong synthetic password').expect(401);

      const secrets = [email, PASSWORD, NEW_PASSWORD, confirmation, reset];
      secrets.push(...valuesOf(cookies), ...valuesOf(next));
      for (const secret of secrets) expect(logs.text()).not.toContain(secret);
    });

    it('hold nothing of a mail server that names the address in its refusal', async () => {
      const email = await register();
      sender.send.mockRejectedValueOnce(new Error(`550 no mailbox ${email}`));
      await outbox().processDue();
      expect(logs.text()).not.toContain(email);
      expect(logs.text()).not.toContain('no mailbox');
    });
  });

  describe('the audit log (ADR 0004 §9)', () => {
    it('names a person by id only, and the app role cannot change it', async () => {
      const { email } = await signedIn();
      const user = await platform().user.findUniqueOrThrow({ where: { email } });
      const rows = await platform().platformAuditEvent.findMany({
        where: { actor: `user:${user.id}` },
        orderBy: { occurredAt: 'asc' },
      });
      expect(rows.map(({ action }) => action)).toEqual(['auth.register', 'auth.login']);
      expect(JSON.stringify(rows)).not.toContain(email);
      await expect(platform().$executeRaw`DELETE FROM platform_audit_events`).rejects.toThrow();
      await expect(
        platform().$executeRaw`UPDATE platform_audit_events SET actor = 'someone'`,
      ).rejects.toThrow();
    });
  });
});

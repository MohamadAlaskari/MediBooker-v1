/**
 * Accounts, sessions and their e-mails against a real platform database (08 A01, A02, A03).
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import request, { type Response } from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformPrismaService } from '../../src/common/database/platform-prisma.service.js';
import { PlatformAudit } from '../../src/common/security/platform-audit.js';
import { FixedClock } from '../../src/common/time/fixed-clock.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AccountOutbox } from '../../src/modules/notifications/account-outbox.js';
import { type Email, EmailSender } from '../../src/modules/notifications/email-sender.js';
import { createTestApp } from '../support/create-test-app.js';
import { captureLogs } from '../support/log-capture.js';
import { usePracticeDatabases } from '../support/practices.js';
import { problemWithoutRequestId } from '../support/problem.js';

const AUTH = '/api/v1/auth';
const ME = '/api/v1/me';
const PASSWORD = 'synthetic correct horse battery';
const NEW_PASSWORD = 'another synthetic passphrase here';
/** On the bundled list of known passwords. */
const WELL_KNOWN = '1234567890';
const PRIVACY_NOTICE = '2026-11';
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const CONFIRMATION_SUBJECT = 'Please confirm your e-mail address';
const RESET_SUBJECT = 'Reset your password';

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
      });

      const token = await confirmationToken(email);
      await post('verify-email', { token }).expect(204);
      expect((await getMe(cookies).expect(200)).body).toMatchObject({ emailVerified: true });

      const again = await post('verify-email', { token }).expect(400);
      expect(again.body).toMatchObject({ code: 'INVALID_TOKEN' });
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
      expect(await statusOf(post('verify-email', { token: inTime }))).toBe(204);
      clock.set(NOW.add({ minutes: 30 }));
      expect(await statusOf(post('verify-email', { token: tooLate }))).toBe(400);
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
      const answer = await post('register', { ...body, email: 'kiK@example.test' }).expect(400);
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
      expect(cookies).toHaveLength(3);
      for (const cookie of cookies) {
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('SameSite=Strict');
      }
      expect(cookies.filter((cookie) => cookie.includes('HttpOnly'))).toHaveLength(2);
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
      const auth = app.get<{ countAttempt: (address: string) => Promise<unknown> }>(AuthService);
      const countAttempt = auth.countAttempt.bind(auth);
      vi.spyOn(auth, 'countAttempt').mockImplementationOnce(async (address) => {
        const attempt = await countAttempt(address);
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

      await post('verify-email', { token: confirmation }).expect(204);
      await post('password/forgot', { email }).expect(202);
      const reset = await resetToken(email);
      expect(await statusOf(post('verify-email', { token: reset }))).toBe(400);
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

  describe('the logs (02 §8)', () => {
    it('hold no address, password or token of a whole journey', async () => {
      const email = await register();
      const confirmation = await confirmationToken(email);
      await post('verify-email', { token: confirmation }).expect(204);
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

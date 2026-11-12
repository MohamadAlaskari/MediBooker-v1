/**
 * Session control and the security e-mails against a real platform database (A04 part 2b, ADR 0004
 * §8): failed sign-ins that decay, counted apart for a browser the account knows and capped for every
 * other client, a family's absolute end, the "new sign-in" e-mail (E10) with its "this was not me",
 * the "password changed" e-mail (BR-21) and the account's own sign-ins.
 */
import { PRIVACY_NOTICE_VERSION } from '@medibooker/i18n';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformPrismaService } from '../../src/common/database/platform-prisma.service.js';
import { FixedClock } from '../../src/common/time/fixed-clock.js';
import { AccountOutbox } from '../../src/modules/notifications/account-outbox.js';
import { type Email, EmailSender } from '../../src/modules/notifications/email-sender.js';
import { createTestApp } from '../support/create-test-app.js';
import { captureLogs } from '../support/log-capture.js';
import { usePracticeDatabases } from '../support/practices.js';

const AUTH = '/api/v1/auth';
const ME = '/api/v1/me';
const PASSWORD = 'synthetic correct horse battery';
const NEW_PASSWORD = 'another synthetic passphrase here';
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FIREFOX_ANDROID = 'Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0';
const DEVICE_COOKIE = '__Secure-mb_device';
const SUBJECTS = {
  confirm: 'Please confirm your e-mail address',
  reset: 'Reset your password',
  newSignIn: 'New sign-in to your account',
  changed: 'Your password was changed',
};

/** What a browser keeps after a sign-in. */
interface Browser {
  access: string;
  refresh: string;
  csrf: string;
  device: string;
}

function cookieOf(response: Response, name: string): string {
  const header = (response.headers['set-cookie'] ?? []) as unknown as string[];
  return (
    header
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.split(';')[0]
      ?.slice(name.length + 1) ?? ''
  );
}

describe('session control and the security e-mails (A04, ADR 0004 §8)', () => {
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
  let app: NestExpressApplication;
  let addresses = 0;
  let clients = 0;
  let client = '';

  const server = (): ReturnType<NestExpressApplication['getHttpServer']> => app.getHttpServer();
  const platform = (): PlatformPrismaService => app.get(PlatformPrismaService);
  const outbox = (): AccountOutbox => app.get(AccountOutbox);
  const post = (path: string, body: object = {}): request.Test =>
    request(server()).post(`${AUTH}/${path}`).set('X-Forwarded-For', client).send(body);

  const emailsTo = async (to: string, subject: string): Promise<Email[]> => {
    await outbox().processDue();
    return sent.filter((email) => email.to === to && email.subject === subject);
  };
  const tokenIn = async (to: string, subject: string): Promise<string> => {
    const email = (await emailsTo(to, subject)).at(-1);
    return /#token=([\w-]+)/.exec(email?.text ?? '')?.[1] ?? '';
  };

  /** A confirmed account, as most of these rules ask for one. */
  const confirmedAccount = async (): Promise<string> => {
    addresses += 1;
    const email = `session-${String(addresses)}@example.test`;
    await post('register', {
      email,
      password: PASSWORD,
      locale: 'en',
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    }).expect(202);
    const token = await tokenIn(email, SUBJECTS.confirm);
    await post('verify-email', { token, password: PASSWORD }).expect(204);
    return email;
  };

  /** Signs in as a browser: with its device cookie when it has one. */
  const signIn = async (
    email: string,
    options: { device?: string; userAgent?: string; password?: string } = {},
  ): Promise<Browser> => {
    let test = post('login', { email, password: options.password ?? PASSWORD }).set(
      'User-Agent',
      options.userAgent ?? CHROME_WINDOWS,
    );
    if (options.device !== undefined)
      test = test.set('Cookie', `${DEVICE_COOKIE}=${options.device}`);
    const response = await test.expect(200);
    return {
      access: cookieOf(response, 'mb_access'),
      refresh: cookieOf(response, 'mb_refresh'),
      csrf: cookieOf(response, 'mb_csrf'),
      device: cookieOf(response, DEVICE_COOKIE) || (options.device ?? ''),
    };
  };

  /** A sign-in with a password, as a browser with this device key or as any other client. */
  const attempt = (email: string, password: string, device?: string): request.Test => {
    const test = post('login', { email, password });
    return device === undefined ? test : test.set('Cookie', `${DEVICE_COOKIE}=${device}`);
  };

  const countsOf = (email: string) =>
    platform().user.findUniqueOrThrow({
      where: { email },
      select: { failedLoginCount: true, failedSinceSuccess: true, lockedUntil: true },
    });

  const refresh = (browser: Browser): request.Test =>
    post('refresh')
      .set('Cookie', `mb_refresh=${browser.refresh}`)
      .set('X-CSRF-Token', browser.csrf);

  const asMe = (method: 'get' | 'post' | 'delete', path: string, browser: Browser): request.Test =>
    request(server())
      [method](`${ME}${path}`)
      .set('Cookie', `mb_access=${browser.access}`)
      .set('X-CSRF-Token', browser.csrf);

  beforeAll(async () => {
    app = await createTestApp({
      env: { ...databases.apiEnv, TRUST_PROXY_HOPS: '1' },
      logDestination: logs,
      clock,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    clients += 1;
    client = `198.51.100.${String(clients)}`;
    clock.set(NOW);
  });

  describe('failed sign-ins', () => {
    it('forget one failure for every hour, so a later guess keeps nobody waiting', async () => {
      const email = await confirmedAccount();
      for (let failure = 0; failure < 5; failure += 1) {
        await attempt(email, NEW_PASSWORD).expect(401);
      }
      // The fifth failure made the account wait: even the right password does not count.
      await attempt(email, PASSWORD).expect(401);

      clock.advance({ hours: 3 });
      await attempt(email, NEW_PASSWORD).expect(401);
      // 5 failures, three hours later 2 left, and this one: 3, and no wait.
      expect(await countsOf(email)).toMatchObject({ failedLoginCount: 3, failedSinceSuccess: 6 });
      await attempt(email, PASSWORD).expect(200);
      expect(await countsOf(email)).toMatchObject({ failedLoginCount: 0, failedSinceSuccess: 0 });
    });

    it('never make a browser the account knows wait for a stranger’s guesses', async () => {
      const email = await confirmedAccount();
      const home = await signIn(email);
      const owner = client;
      client = `203.0.113.${String(clients)}`;
      for (let failure = 0; failure < 6; failure += 1) {
        await attempt(email, NEW_PASSWORD).expect(401);
      }
      // Any other client waits, also with the right password.
      await attempt(email, PASSWORD).expect(401);
      // The owner's browser counts on its own and comes in.
      client = owner;
      await attempt(email, PASSWORD, home.device).expect(200);
      // Its success gives the stranger no new guesses.
      expect(await countsOf(email)).toMatchObject({ failedLoginCount: 5, failedSinceSuccess: 5 });
      await attempt(email, PASSWORD).expect(401);
    });

    it('of a known browser count against it alone, and its success clears them', async () => {
      const email = await confirmedAccount();
      const home = await signIn(email);
      for (let failure = 0; failure < 5; failure += 1) {
        await attempt(email, NEW_PASSWORD, home.device).expect(401);
      }
      await attempt(email, PASSWORD, home.device).expect(401);
      // Nothing of it holds another client.
      expect(await countsOf(email)).toMatchObject({ failedLoginCount: 0, failedSinceSuccess: 0 });
      await attempt(email, PASSWORD).expect(200);

      clock.advance({ minutes: 2 });
      await attempt(email, PASSWORD, home.device).expect(200);
      const devices = await platform().knownDevice.findMany({
        where: { user: { email } },
        select: { failedCount: true, lockedUntil: true },
      });
      expect(devices).toEqual(
        expect.arrayContaining([expect.objectContaining({ failedCount: 0, lockedUntil: null })]),
      );
      expect(devices.every(({ failedCount }) => failedCount === 0)).toBe(true);
    });

    it('stop other clients after 100 since the last success, until a new password', async () => {
      const email = await confirmedAccount();
      const home = await signIn(email);
      await platform().user.update({ where: { email }, data: { failedSinceSuccess: 99 } });
      await attempt(email, NEW_PASSWORD).expect(401);

      // The hundredth: no other client gets in, now or later, even with the right password.
      await attempt(email, PASSWORD).expect(401);
      clock.advance({ hours: 24 });
      const refused = await attempt(email, PASSWORD);
      expect(refused.body).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
      expect(await countsOf(email)).toMatchObject({ failedSinceSuccess: 100 });
      // The owner's browser still comes in, and that opens nothing for the others.
      await attempt(email, PASSWORD, home.device).expect(200);
      await attempt(email, PASSWORD).expect(401);

      // A new password from the mailbox does.
      await post('password/forgot', { email }).expect(202);
      const reset = await tokenIn(email, SUBJECTS.reset);
      await post('password/reset', { token: reset, password: NEW_PASSWORD }).expect(204);
      await attempt(email, NEW_PASSWORD).expect(200);
    });
  });

  describe('a sign-in ends 90 days after it began', () => {
    it('refreshes within its family until then, never past it', async () => {
      const email = await confirmedAccount();
      let browser = await signIn(email);
      for (const hours of [29 * 24, 29 * 24, 29 * 24]) {
        clock.advance({ hours });
        const response = await refresh(browser).expect(200);
        browser = {
          ...browser,
          refresh: cookieOf(response, 'mb_refresh'),
          csrf: cookieOf(response, 'mb_csrf'),
        };
      }
      // Day 87: the newest token expires with its family, at day 90, not 30 days later.
      const newest = await platform().session.findFirstOrThrow({
        where: { user: { email }, rotatedAt: null, revokedAt: null },
        select: { expiresAt: true, familyStartedAt: true },
      });
      expect(newest.familyStartedAt?.toISOString()).toBe(NOW.toString().replace('Z', '.000Z'));
      expect(
        Temporal.Instant.from(newest.expiresAt.toISOString()).equals(NOW.add({ hours: 90 * 24 })),
      ).toBe(true);

      clock.set(NOW.add({ hours: 90 * 24 }));
      await refresh(browser).expect(401);
    });
  });

  describe('the "new sign-in" e-mail (E10)', () => {
    it('tells nothing for the first browser, nor when it comes back', async () => {
      const email = await confirmedAccount();
      const first = await signIn(email);
      expect(first.device).toMatch(/^[\w-]{43}$/);
      await signIn(email, { device: first.device });
      expect(await emailsTo(email, SUBJECTS.newSignIn)).toEqual([]);
    });

    it('tells of another browser, with its device and the way back', async () => {
      const email = await confirmedAccount();
      await signIn(email);
      await signIn(email, { userAgent: FIREFOX_ANDROID });
      const [notice] = await emailsTo(email, SUBJECTS.newSignIn);
      expect(notice?.text).toContain('Firefox · Android');
      expect(notice?.text).toMatch(/\/en\/secure-account#token=[\w-]+/);
      expect(notice?.text).toContain('The link is valid for 7 days.');
    });

    it('tells an address nobody confirmed nothing: it may be someone else’s', async () => {
      addresses += 1;
      const email = `unconfirmed-${String(addresses)}@example.test`;
      await post('register', {
        email,
        password: PASSWORD,
        locale: 'en',
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      }).expect(202);
      await signIn(email);
      await signIn(email, { userAgent: FIREFOX_ANDROID });
      expect(await emailsTo(email, SUBJECTS.newSignIn)).toEqual([]);
    });

    it('tells of a sign-in of the app, which keeps no device cookie', async () => {
      const email = await confirmedAccount();
      await signIn(email);
      const fromTheApp = await post('login', { email, password: PASSWORD, delivery: 'body' })
        .set('User-Agent', 'MediBooker/1.0 (Android 15)')
        .expect(200);
      expect(cookieOf(fromTheApp, DEVICE_COOKIE)).toBe('');
      const [notice] = await emailsTo(email, SUBJECTS.newSignIn);
      expect(notice?.text).toContain('MediBooker App · Android');
    });

    it('tells of every sign-in but the very first of an account that used only the app', async () => {
      const email = await confirmedAccount();
      const app = (): request.Test =>
        post('login', { email, password: PASSWORD, delivery: 'body' })
          .set('User-Agent', 'MediBooker/1.0 (Android 15)')
          .expect(200);
      await app();
      expect(await emailsTo(email, SUBJECTS.newSignIn)).toEqual([]);
      await app();
      expect(await emailsTo(email, SUBJECTS.newSignIn)).toHaveLength(1);
      // A browser after the app is no first one: the account knows it not (the review of part 2b).
      await signIn(email, { userAgent: FIREFOX_ANDROID });
      const notices = await emailsTo(email, SUBJECTS.newSignIn);
      expect(notices).toHaveLength(2);
      expect(notices[1]?.text).toContain('Firefox · Android');
    });
  });

  describe('"this was not me"', () => {
    it('ends every sign-in, stops the password and sends a link for a new one, once', async () => {
      const email = await confirmedAccount();
      const home = await signIn(email);
      const stranger = await signIn(email, { userAgent: FIREFOX_ANDROID });
      const token = await tokenIn(email, SUBJECTS.newSignIn);

      await post('sessions/revoke-all', { token }).expect(204);

      await refresh(home).expect(401);
      await refresh(stranger).expect(401);
      await post('login', { email, password: PASSWORD }).expect(401);
      expect(await emailsTo(email, SUBJECTS.reset)).toHaveLength(1);
      await post('sessions/revoke-all', { token }).expect(400);
      expect(await platform().knownDevice.count({ where: { user: { email } } })).toBe(0);
      const audit = await platform().platformAuditEvent.count({
        where: { action: 'auth.account.secure', outcome: 'SUCCEEDED' },
      });
      expect(audit).toBeGreaterThan(0);

      // The owner chooses a new password, and is told of it with the same way back.
      const reset = await tokenIn(email, SUBJECTS.reset);
      await post('password/reset', { token: reset, password: NEW_PASSWORD }).expect(204);
      await post('login', { email, password: NEW_PASSWORD }).expect(200);
      const [changed] = await emailsTo(email, SUBJECTS.changed);
      expect(changed?.text).toMatch(/\/en\/secure-account#token=[\w-]+/);
      // Every browser was forgotten, so even the owner's is new again and told of.
      expect(await emailsTo(email, SUBJECTS.newSignIn)).toHaveLength(2);
    });

    it('refuses a token that is not one of its links', async () => {
      const unknown = await post('sessions/revoke-all', { token: 'not-a-token' });
      expect(unknown.body).toMatchObject({ status: 400, code: 'INVALID_TOKEN' });
      const email = await confirmedAccount();
      await post('password/forgot', { email }).expect(202);
      const reset = await tokenIn(email, SUBJECTS.reset);
      // A reset link is no link to secure an account.
      const other = await post('sessions/revoke-all', { token: reset });
      expect(other.body).toMatchObject({ status: 400, code: 'INVALID_TOKEN' });
      // The account works on, and its reset link too.
      await signIn(email);
      await post('password/reset', { token: reset, password: NEW_PASSWORD }).expect(204);
    });
  });

  describe('the own sign-ins', () => {
    it('lists them with their device, ends one, and ends all others', async () => {
      const email = await confirmedAccount();
      const laptop = await signIn(email);
      clock.advance({ minutes: 5 });
      const phone = await signIn(email, { userAgent: FIREFOX_ANDROID });
      clock.advance({ minutes: 5 });
      const tablet = await signIn(email, { device: laptop.device });

      const listed = await asMe('get', '/sessions', laptop).expect(200);
      expect(listed.body).toHaveLength(3);
      expect(listed.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ device: 'Chrome · Windows', current: true }),
          expect.objectContaining({ device: 'Firefox · Android', current: false }),
        ]),
      );
      const phoneSignIn = (listed.body as { id: string; device: string }[]).find(
        (signIn) => signIn.device === 'Firefox · Android',
      );

      await asMe('delete', `/sessions/${phoneSignIn?.id ?? ''}`, laptop).expect(204);
      await refresh(phone).expect(401);
      await asMe('delete', `/sessions/${phoneSignIn?.id ?? ''}`, laptop).expect(404);
      await asMe('delete', '/sessions/not-a-uuid', laptop).expect(404);

      await asMe('post', '/sessions/revoke-others', laptop).expect(204);
      await refresh(tablet).expect(401);
      const left = await asMe('get', '/sessions', laptop).expect(200);
      expect(left.body).toEqual([expect.objectContaining({ current: true })]);
      await refresh(laptop).expect(200);
    });

    it('cannot end the sign-in of another account', async () => {
      const mine = await signIn(await confirmedAccount());
      const theirs = await signIn(await confirmedAccount());
      const [theirSignIn] = (await asMe('get', '/sessions', theirs).expect(200)).body as {
        id: string;
      }[];
      const refused = await asMe('delete', `/sessions/${theirSignIn?.id ?? ''}`, mine);
      expect(refused.body).toMatchObject({ status: 404, code: 'NOT_FOUND' });
      expect((await refresh(theirs)).status).toBe(200);
    });
  });
});

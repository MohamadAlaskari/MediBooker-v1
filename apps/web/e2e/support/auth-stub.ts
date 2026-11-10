/**
 * Accounts as the API keeps them, in memory: the cookies, the CSRF header, the single-use links and
 * the answers of the contract. The real rules are tested against the API; this lets the pages meet
 * every case on demand.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProfileDto } from '@medibooker/api-client';
import { bodyOf, numberEndOf, problem, respond } from './answers.ts';

interface Account {
  readonly id: string;
  readonly email: string;
  password: string;
  verified: boolean;
  locale: string;
  /** The second factor (A04): set up, waiting for its first code, or none. */
  mfa: 'off' | 'pending' | 'on';
  /** The role in the installation's practice, which the operator's command gives. */
  role?: 'STAFF' | 'DOCTOR' | 'ADMIN';
}

/** The only code of the stub's authenticator app, and its only recovery code, as typed. */
export const STUB_CODE = '123456';
export const STUB_RECOVERY_CODE = 'abcde-fghjk';
/** What the QR code of the stub holds: a well-known example in base32, twice for 160 bits. */
const STUB_APP_TEXT = 'JBSWY3DPEHPK3PXP'.repeat(2);

/** What a person sends: what is left out is not known. */
type ProfileBody = Pick<ProfileDto, 'firstName' | 'lastName' | 'dateOfBirth' | 'insuranceType'> & {
  readonly phone?: string;
  readonly insuranceProvider?: string;
  readonly insuranceNumber?: string;
};

const BREACHED = '1234567890';
const accounts = new Map<string, Account>();
const accessTokens = new Map<string, string>();
const refreshTokens = new Map<string, string>();
/** The tokens of sessions that were opened with both factors. */
const withSecondFactor = new Set<string>();
/** A link's token and what it may do, once. */
const links = new Map<string, { email: string; purpose: 'confirm' | 'reset' }>();
const newestLink = new Map<string, string>();
const profiles = new Map<string, ProfileDto>();

function cookiesOf(request: IncomingMessage): Map<string, string> {
  return new Map(
    (request.headers.cookie ?? '').split('; ').map((cookie): [string, string] => {
      const [name = '', value = ''] = cookie.split('=');
      return [name, value];
    }),
  );
}

function issueLink(email: string, purpose: 'confirm' | 'reset'): void {
  const token = randomUUID();
  links.set(token, { email, purpose });
  newestLink.set(`${email}:${purpose}`, token);
}

function setSession(response: ServerResponse, email: string, secondFactor = false): void {
  const access = randomUUID();
  const refresh = randomUUID();
  accessTokens.set(access, email);
  refreshTokens.set(refresh, email);
  if (secondFactor) {
    withSecondFactor.add(access);
    withSecondFactor.add(refresh);
  }
  const strict = 'Secure; SameSite=Strict';
  response.setHeader('Set-Cookie', [
    `mb_access=${access}; Path=/api; Max-Age=900; ${strict}; HttpOnly`,
    `mb_refresh=${refresh}; Path=/api/v1/auth; Max-Age=2592000; ${strict}; HttpOnly`,
    `mb_csrf=${refresh}; Path=/; Max-Age=2592000; ${strict}`,
  ]);
}

function clearSession(response: ServerResponse): void {
  const strict = 'Secure; SameSite=Strict';
  response.setHeader('Set-Cookie', [
    `mb_access=; Path=/api; Max-Age=0; ${strict}; HttpOnly`,
    `mb_refresh=; Path=/api/v1/auth; Max-Age=0; ${strict}; HttpOnly`,
    `mb_csrf=; Path=/; Max-Age=0; ${strict}`,
  ]);
}

function accountDto({ id, email, verified, locale, mfa }: Account): object {
  return { id, email, emailVerified: verified, locale, mfaEnabled: mfa === 'on' };
}

/** What a person typed as a recovery code, as the API reads it. */
function recoveryCodeOf(input: string): string {
  return input.replaceAll(/[\s-]/g, '').toLowerCase();
}

function endSessions(email: string): void {
  for (const tokens of [accessTokens, refreshTokens]) {
    for (const [token, owner] of tokens) if (owner === email) tokens.delete(token);
  }
}

/** The CSRF header of a cookie request: the value of the session's own readable cookie. */
export function hasCsrfHeader(request: IncomingMessage): boolean {
  const header = request.headers['x-csrf-token'];
  return header !== undefined && header === cookiesOf(request).get('mb_csrf');
}

async function handleRoute(
  route: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await bodyOf(request);
  const { email = '', password = '', token = '' } = body;
  if (route === 'register') {
    if (password === BREACHED) {
      problem(response, 'VALIDATION_FAILED', {
        errors: [{ field: 'password', code: 'PASSWORD_BREACHED' }],
      });
      return;
    }
    if (!accounts.has(email)) {
      const locale = body.locale ?? 'ar';
      accounts.set(email, {
        id: randomUUID(),
        email,
        password,
        verified: false,
        locale,
        mfa: 'off',
      });
      issueLink(email, 'confirm');
    }
    respond(response, 202);
    return;
  }
  if (route === 'login') {
    const account = accounts.get(email);
    if (account?.password !== password) {
      problem(response, 'INVALID_CREDENTIALS');
      return;
    }
    if (account.mfa === 'on') {
      const { code, recoveryCode } = body;
      if (code === undefined && recoveryCode === undefined) {
        problem(response, 'MFA_CODE_REQUIRED');
        return;
      }
      const right =
        code === STUB_CODE ||
        (recoveryCode !== undefined &&
          recoveryCodeOf(recoveryCode) === recoveryCodeOf(STUB_RECOVERY_CODE));
      if (!right) {
        problem(response, 'MFA_CODE_INVALID');
        return;
      }
    }
    setSession(response, email, account.mfa === 'on');
    respond(response, 200, { account: accountDto(account) });
    return;
  }
  if (route === 'verify-email') {
    const link = links.get(token);
    const account = accounts.get(link?.email ?? '');
    if (link?.purpose !== 'confirm' || account === undefined) {
      problem(response, 'INVALID_TOKEN');
      return;
    }
    if (account.password !== password) {
      problem(response, 'INVALID_CREDENTIALS');
      return;
    }
    links.delete(token);
    account.verified = true;
    respond(response, 204);
    return;
  }
  if (route === 'verify-email/resend') {
    if (accounts.has(email)) issueLink(email, 'confirm');
    respond(response, 202);
    return;
  }
  if (route === 'password/forgot') {
    if (accounts.has(email)) issueLink(email, 'reset');
    respond(response, 202);
    return;
  }
  if (route === 'password/reset') {
    const link = links.get(token);
    const account = accounts.get(link?.email ?? '');
    if (link?.purpose !== 'reset' || account === undefined) {
      problem(response, 'INVALID_TOKEN');
      return;
    }
    if (password === BREACHED) {
      problem(response, 'VALIDATION_FAILED', {
        errors: [{ field: 'password', code: 'PASSWORD_BREACHED' }],
      });
      return;
    }
    links.delete(token);
    account.password = password;
    account.verified = true;
    endSessions(account.email);
    respond(response, 204);
    return;
  }
  if (route === 'refresh') {
    const presented = cookiesOf(request).get('mb_refresh') ?? '';
    const owner = accounts.get(refreshTokens.get(presented) ?? '');
    if (owner === undefined) {
      problem(response, 'UNAUTHENTICATED');
      return;
    }
    if (!hasCsrfHeader(request)) {
      problem(response, 'FORBIDDEN');
      return;
    }
    refreshTokens.delete(presented);
    setSession(response, owner.email, withSecondFactor.has(presented));
    respond(response, 200, { account: accountDto(owner) });
    return;
  }
  if (route === 'logout') {
    const presented = cookiesOf(request).get('mb_refresh');
    if (presented === undefined) {
      respond(response, 204);
      return;
    }
    if (!hasCsrfHeader(request)) {
      problem(response, 'FORBIDDEN');
      return;
    }
    endSessions(refreshTokens.get(presented) ?? '');
    clearSession(response);
    respond(response, 204);
    return;
  }
  problem(response, 'NOT_FOUND');
}

async function handleProfile(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const owner = accessTokens.get(cookiesOf(request).get('mb_access') ?? '') ?? '';
  if (!accounts.has(owner)) {
    problem(response, 'UNAUTHENTICATED');
    return;
  }
  if (request.method === 'GET') {
    const profile = profiles.get(owner);
    if (profile === undefined) problem(response, 'NOT_FOUND');
    else respond(response, 200, profile);
    return;
  }
  if (!hasCsrfHeader(request)) {
    problem(response, 'FORBIDDEN');
    return;
  }
  const { insuranceNumber, ...details } = await bodyOf<ProfileBody>(request);
  if (details.dateOfBirth === '2030-01-01') {
    problem(response, 'VALIDATION_FAILED', {
      errors: [{ field: 'dateOfBirth', code: 'INVALID_VALUE' }],
    });
    return;
  }
  const known = profiles.get(owner)?.insuranceNumberEnd ?? null;
  const profile: ProfileDto = {
    phone: null,
    insuranceProvider: null,
    ...details,
    insuranceNumberEnd:
      details.insuranceType === 'SELF_PAY'
        ? null
        : insuranceNumber === undefined
          ? known
          : numberEndOf(insuranceNumber),
  };
  profiles.set(owner, profile);
  respond(response, 200, profile);
}

/** Whose access cookie a request carries, for the stub's other parts. */
export function ownerOf(request: IncomingMessage): string | undefined {
  const owner = accessTokens.get(cookiesOf(request).get('mb_access') ?? '');
  return owner !== undefined && accounts.has(owner) ? owner : undefined;
}

export function isVerified(email: string): boolean {
  return accounts.get(email)?.verified === true;
}

/** What the account knows of a person, which a join copies. */
export function profileOf(email: string): ProfileDto | undefined {
  return profiles.get(email);
}

/** POST /me/mfa/totp and /me/mfa/totp/confirm, for the signed-in owner of the request. */
async function handleSecondFactor(
  route: 'start' | 'confirm',
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const owner = accessTokens.get(cookiesOf(request).get('mb_access') ?? '') ?? '';
  const account = accounts.get(owner);
  if (request.method !== 'POST') problem(response, 'NOT_FOUND');
  else if (account === undefined) problem(response, 'UNAUTHENTICATED');
  else if (!hasCsrfHeader(request)) problem(response, 'FORBIDDEN');
  else if (account.mfa === 'on') problem(response, 'MFA_ALREADY_ENABLED');
  else if (route === 'start' && account.role === undefined) problem(response, 'FORBIDDEN');
  else if (route === 'start') {
    account.mfa = 'pending';
    respond(response, 200, {
      secret: STUB_APP_TEXT,
      otpauthUri: `otpauth://totp/Stub:${encodeURIComponent(owner)}?secret=${STUB_APP_TEXT}&issuer=Stub`,
    });
  } else {
    const { code } = await bodyOf(request);
    if (account.mfa !== 'pending' || code !== STUB_CODE) {
      problem(response, 'MFA_CODE_INVALID');
      return;
    }
    account.mfa = 'on';
    endSessions(owner);
    setSession(response, owner, true);
    const recoveryCodes = [STUB_RECOVERY_CODE];
    for (let index = 1; index < 10; index += 1) recoveryCodes.push(`stub${String(index)}-codes`);
    respond(response, 200, { account: accountDto(account), recoveryCodes });
  }
}

const MEMBERSHIP_PATH = /^\/api\/v1\/practices\/[^/]+\/me\/membership$/;

/** Takes the requests about accounts, and answers whether it did. */
export function handleAccounts(
  pathname: string,
  searchParams: URLSearchParams,
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  const email = searchParams.get('email') ?? '';
  const { method } = request;
  if (pathname === '/__links') {
    respond(response, 200, {
      confirm: newestLink.get(`${email}:confirm`),
      reset: newestLink.get(`${email}:reset`),
    });
    return true;
  }
  if (pathname === '/__staff') {
    const account = accounts.get(email);
    const role = searchParams.get('role');
    if (account !== undefined && (role === 'STAFF' || role === 'DOCTOR' || role === 'ADMIN')) {
      account.role = role;
    }
    respond(response, 204);
    return true;
  }
  if (pathname === '/__second-factor') {
    const account = accounts.get(email);
    if (account !== undefined) account.mfa = 'on';
    respond(response, 204);
    return true;
  }
  if (pathname === '/api/v1/me/mfa/totp' || pathname === '/api/v1/me/mfa/totp/confirm') {
    void handleSecondFactor(pathname.endsWith('confirm') ? 'confirm' : 'start', request, response);
    return true;
  }
  if (MEMBERSHIP_PATH.test(pathname)) {
    const access = cookiesOf(request).get('mb_access') ?? '';
    const account = accounts.get(accessTokens.get(access) ?? '');
    if (method !== 'GET') problem(response, 'NOT_FOUND');
    else if (account === undefined) problem(response, 'UNAUTHENTICATED');
    else if (!withSecondFactor.has(access)) problem(response, 'MFA_REQUIRED');
    else if (account.role === undefined) problem(response, 'NOT_FOUND');
    else respond(response, 200, { role: account.role });
    return true;
  }
  if (pathname === '/__end-access') {
    for (const [token, owner] of accessTokens) if (owner === email) accessTokens.delete(token);
    respond(response, 204);
    return true;
  }
  if (pathname === '/__end-sessions') {
    endSessions(email);
    respond(response, 204);
    return true;
  }
  if (pathname === '/api/v1/me/unconfirmed') {
    const owner = accessTokens.get(cookiesOf(request).get('mb_access') ?? '') ?? '';
    const account = accounts.get(owner);
    if (method !== 'DELETE') problem(response, 'NOT_FOUND');
    else if (account === undefined) problem(response, 'UNAUTHENTICATED');
    else if (!hasCsrfHeader(request)) problem(response, 'FORBIDDEN');
    else if (account.verified) problem(response, 'CONFLICT');
    else {
      accounts.delete(owner);
      profiles.delete(owner);
      endSessions(owner);
      clearSession(response);
      respond(response, 204);
    }
    return true;
  }
  if (pathname === '/api/v1/me/profile') {
    if (method === 'GET' || method === 'PUT') void handleProfile(request, response);
    else problem(response, 'NOT_FOUND');
    return true;
  }
  if (pathname === '/api/v1/me') {
    const owner = accessTokens.get(cookiesOf(request).get('mb_access') ?? '');
    const account = accounts.get(owner ?? '');
    if (method !== 'GET') problem(response, 'NOT_FOUND');
    else if (account === undefined) problem(response, 'UNAUTHENTICATED');
    else respond(response, 200, accountDto(account));
    return true;
  }
  if (pathname.startsWith('/api/v1/auth/')) {
    if (method === 'POST')
      void handleRoute(pathname.slice('/api/v1/auth/'.length), request, response);
    else problem(response, 'NOT_FOUND');
    return true;
  }
  return false;
}

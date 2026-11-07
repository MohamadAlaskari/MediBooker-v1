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
}

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

function setSession(response: ServerResponse, email: string): void {
  const access = randomUUID();
  const refresh = randomUUID();
  accessTokens.set(access, email);
  refreshTokens.set(refresh, email);
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

function accountDto({ id, email, verified, locale }: Account): object {
  return { id, email, emailVerified: verified, locale };
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
      accounts.set(email, { id: randomUUID(), email, password, verified: false, locale });
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
    setSession(response, email);
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
    setSession(response, owner.email);
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

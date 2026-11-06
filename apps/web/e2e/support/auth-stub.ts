/**
 * Accounts as the API keeps them, in memory: the cookies, the CSRF header, the single-use links and
 * the answers of the contract. The real rules are tested against the API; this lets the pages meet
 * every case on demand.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface Account {
  readonly id: string;
  readonly email: string;
  password: string;
  verified: boolean;
  locale: string;
}

const BREACHED = '1234567890';
const accounts = new Map<string, Account>();
const accessTokens = new Map<string, string>();
const refreshTokens = new Map<string, string>();
/** A link's token and what it may do, once. */
const links = new Map<string, { email: string; purpose: 'confirm' | 'reset' }>();
const newestLink = new Map<string, string>();
const profiles = new Map<string, Record<string, unknown>>();

function respond(response: ServerResponse, status: number, body?: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function problem(
  response: ServerResponse,
  status: number,
  code: string,
  errors?: readonly { field: string; code: string }[],
): void {
  response.writeHead(status, { 'Content-Type': 'application/problem+json' });
  response.end(
    JSON.stringify({
      type: `urn:medibooker:problem:${code.toLowerCase().replaceAll('_', '-')}`,
      title: code,
      status,
      detail: code,
      code,
      requestId: '30000000-0000-4000-8000-000000000002',
      ...(errors === undefined ? {} : { errors }),
    }),
  );
}

async function bodyOf(request: IncomingMessage): Promise<Record<string, string | undefined>> {
  let text = '';
  for await (const chunk of request) text += String(chunk);
  return text === '' ? {} : (JSON.parse(text) as Record<string, string | undefined>);
}

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
function hasCsrfHeader(request: IncomingMessage): boolean {
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
      problem(response, 400, 'VALIDATION_FAILED', [
        { field: 'password', code: 'PASSWORD_BREACHED' },
      ]);
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
      problem(response, 401, 'INVALID_CREDENTIALS');
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
      problem(response, 400, 'INVALID_TOKEN');
      return;
    }
    if (account.password !== password) {
      problem(response, 401, 'INVALID_CREDENTIALS');
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
      problem(response, 400, 'INVALID_TOKEN');
      return;
    }
    if (password === BREACHED) {
      problem(response, 400, 'VALIDATION_FAILED', [
        { field: 'password', code: 'PASSWORD_BREACHED' },
      ]);
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
      problem(response, 401, 'UNAUTHENTICATED');
      return;
    }
    if (!hasCsrfHeader(request)) {
      problem(response, 403, 'FORBIDDEN');
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
      problem(response, 403, 'FORBIDDEN');
      return;
    }
    endSessions(refreshTokens.get(presented) ?? '');
    clearSession(response);
    respond(response, 204);
    return;
  }
  problem(response, 404, 'NOT_FOUND');
}

async function handleProfile(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const owner = accessTokens.get(cookiesOf(request).get('mb_access') ?? '') ?? '';
  if (!accounts.has(owner)) {
    problem(response, 401, 'UNAUTHENTICATED');
    return;
  }
  if (request.method === 'GET') {
    const profile = profiles.get(owner);
    if (profile === undefined) problem(response, 404, 'NOT_FOUND');
    else respond(response, 200, profile);
    return;
  }
  if (!hasCsrfHeader(request)) {
    problem(response, 403, 'FORBIDDEN');
    return;
  }
  const { insuranceNumber, ...details } = await bodyOf(request);
  if (details.dateOfBirth === '2030-01-01') {
    problem(response, 400, 'VALIDATION_FAILED', [{ field: 'dateOfBirth', code: 'INVALID_VALUE' }]);
    return;
  }
  const known = profiles.get(owner)?.insuranceNumberEnd ?? null;
  const profile = {
    phone: null,
    insuranceProvider: null,
    ...details,
    insuranceNumberEnd:
      details.insuranceType === 'SELF_PAY' ? null : (insuranceNumber?.slice(-4) ?? known),
  };
  profiles.set(owner, profile);
  respond(response, 200, profile);
}

/** Takes the requests about accounts, and answers whether it did. */
export function handleAccounts(
  pathname: string,
  searchParams: URLSearchParams,
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  const email = searchParams.get('email') ?? '';
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
    if (account === undefined) {
      problem(response, 401, 'UNAUTHENTICATED');
    } else if (account.verified) {
      problem(response, 409, 'CONFLICT');
    } else if (!hasCsrfHeader(request)) {
      problem(response, 403, 'FORBIDDEN');
    } else {
      accounts.delete(owner);
      profiles.delete(owner);
      endSessions(owner);
      clearSession(response);
      respond(response, 204);
    }
    return true;
  }
  if (pathname === '/api/v1/me/profile') {
    void handleProfile(request, response);
    return true;
  }
  if (pathname === '/api/v1/me') {
    const owner = accessTokens.get(cookiesOf(request).get('mb_access') ?? '');
    const account = accounts.get(owner ?? '');
    if (account === undefined) problem(response, 401, 'UNAUTHENTICATED');
    else respond(response, 200, accountDto(account));
    return true;
  }
  if (pathname.startsWith('/api/v1/auth/')) {
    void handleRoute(pathname.slice('/api/v1/auth/'.length), request, response);
    return true;
  }
  return false;
}

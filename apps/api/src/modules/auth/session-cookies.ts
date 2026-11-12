import type { ServerResponse } from 'node:http';

/** ADR 0004 §6: tokens only in HttpOnly cookies, and the CSRF token where the page can read it. */
export const ACCESS_COOKIE = 'mb_access';
export const REFRESH_COOKIE = 'mb_refresh';
export const CSRF_COOKIE = 'mb_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const API_PATH = '/api';
/** The refresh token travels only to the routes that use it. */
const AUTH_PATH = '/api/v1/auth';

interface CookieOptions {
  readonly path: string;
  readonly maxAgeSeconds: number;
  readonly httpOnly: boolean;
}

function serialized(name: string, value: string, options: CookieOptions): string {
  const flags = [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${String(options.maxAgeSeconds)}`,
    'Secure',
    'SameSite=Strict',
  ];
  if (options.httpOnly) flags.push('HttpOnly');
  return flags.join('; ');
}

export interface SessionCookieValues {
  readonly accessToken: string;
  readonly accessSeconds: number;
  readonly refreshToken: string;
  readonly refreshSeconds: number;
  readonly csrfToken: string;
}

export function setSessionCookies(response: ServerResponse, values: SessionCookieValues): void {
  const { accessToken, accessSeconds, refreshToken, refreshSeconds, csrfToken } = values;
  response.appendHeader('Set-Cookie', [
    serialized(ACCESS_COOKIE, accessToken, {
      path: API_PATH,
      maxAgeSeconds: accessSeconds,
      httpOnly: true,
    }),
    serialized(REFRESH_COOKIE, refreshToken, {
      path: AUTH_PATH,
      maxAgeSeconds: refreshSeconds,
      httpOnly: true,
    }),
    // Not HttpOnly: the page reads it and sends it back as a header, which another site cannot.
    serialized(CSRF_COOKIE, csrfToken, {
      path: '/',
      maxAgeSeconds: refreshSeconds,
      httpOnly: false,
    }),
  ]);
}

export function clearSessionCookies(response: ServerResponse): void {
  response.appendHeader('Set-Cookie', [
    serialized(ACCESS_COOKIE, '', { path: API_PATH, maxAgeSeconds: 0, httpOnly: true }),
    serialized(REFRESH_COOKIE, '', { path: AUTH_PATH, maxAgeSeconds: 0, httpOnly: true }),
    serialized(CSRF_COOKIE, '', { path: '/', maxAgeSeconds: 0, httpOnly: false }),
  ]);
}

/**
 * The browser of a sign-in (A04, E10): a random key, only in this cookie, of which the platform keeps
 * a keyed hash per account. It reaches the auth routes only, and lives as long as a browser lets a
 * cookie. The `__Secure-` prefix keeps a page over plain HTTP from planting a key of its own, which
 * a sign-in would then make known (the security review of A04 part 2b).
 */
export const DEVICE_COOKIE = '__Secure-mb_device';
const DEVICE_COOKIE_DAYS = 400;
const DEVICE_KEY = /^[A-Za-z0-9_-]{43}$/;

export function setDeviceCookie(response: ServerResponse, key: string): void {
  response.appendHeader(
    'Set-Cookie',
    serialized(DEVICE_COOKIE, key, {
      path: AUTH_PATH,
      maxAgeSeconds: DEVICE_COOKIE_DAYS * 86_400,
      httpOnly: true,
    }),
  );
}

/** The device key of a request, if it sends one of the form this API gives. */
export function deviceKeyOf(header: string | string[] | undefined): string | undefined {
  const key = cookiesOf(header).get(DEVICE_COOKIE);
  return key !== undefined && DEVICE_KEY.test(key) ? key : undefined;
}

/** The cookies of a request. A name that occurs twice keeps its first value, as browsers send. */
export function cookiesOf(header: string | string[] | undefined): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>();
  if (typeof header !== 'string') return cookies;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (!cookies.has(name)) cookies.set(name, part.slice(separator + 1).trim());
  }
  return cookies;
}

/** The token of an `Authorization: Bearer` header. */
export function bearerTokenOf(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer ([\w.~+/-]+=*)$/i.exec(header);
  return match?.[1];
}

export function headerOf(header: string | string[] | undefined): string | undefined {
  return typeof header === 'string' ? header : undefined;
}

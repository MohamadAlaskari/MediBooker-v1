import { configureApiClient } from '@medibooker/api-client';
import { SESSION_HINT_COOKIE } from './session-hint';

const CSRF_HEADER = 'x-csrf-token';
const AUTH_PATH = '/api/v1/auth/';
const REFRESH_PATH = `${AUTH_PATH}refresh`;

function cookieValue(cookies: string, name: string): string | undefined {
  const prefix = `${name}=`;
  return cookies
    .split('; ')
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}

function withCsrfToken(headers: HeadersInit | undefined): Headers {
  const result = new Headers(headers);
  const token = cookieValue(document.cookie, SESSION_HINT_COOKIE);
  if (token !== undefined) result.set(CSRF_HEADER, token);
  return result;
}

let refreshing: Promise<boolean> | undefined;

/** One refresh for everything that found its access token over at the same moment. */
function refreshedSession(): Promise<boolean> {
  refreshing ??= globalThis
    .fetch(REFRESH_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: withCsrfToken({ 'Content-Type': 'application/json' }),
      body: '{}',
    })
    .then(
      ({ ok }) => ok,
      () => false,
    )
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}

function pathOf(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.pathname : new URL(input.url).pathname;
}

/**
 * An access token lasts 15 minutes and a page may stay open longer: a 401 gets one refresh and one
 * new try, with the CSRF token of the new session. The answers of the auth routes themselves are
 * meant for the person, and a 401 is what a page shows when a session is really over.
 */
export const sessionFetch: typeof globalThis.fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init);
  if (response.status !== 401 || pathOf(input).startsWith(AUTH_PATH)) return response;
  if (!(await refreshedSession())) return response;
  return globalThis.fetch(input, { ...init, headers: withCsrfToken(init?.headers) });
};

/** The API client of a page in the browser: its own origin, its cookies and its language. */
export function configureBrowserApiClient(locale: string): void {
  configureApiClient({
    baseUrl: '',
    credentials: 'same-origin',
    getHeaders: () => withCsrfToken({ 'Accept-Language': locale }),
    fetch: sessionFetch,
  });
}

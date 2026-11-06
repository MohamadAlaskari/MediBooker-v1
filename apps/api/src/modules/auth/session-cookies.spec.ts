import { ServerResponse, IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  bearerTokenOf,
  clearSessionCookies,
  cookiesOf,
  headerOf,
  setSessionCookies,
} from './session-cookies.js';

function setCookiesOf(apply: (response: ServerResponse) => void): string[] {
  const response = new ServerResponse(new IncomingMessage(new Socket()));
  apply(response);
  return response.getHeader('Set-Cookie') as string[];
}

describe('setSessionCookies', () => {
  const cookies = setCookiesOf((response) => {
    setSessionCookies(response, {
      accessToken: 'access',
      accessSeconds: 900,
      refreshToken: 'refresh',
      refreshSeconds: 2_592_000,
      csrfToken: 'csrf',
    });
  });

  it('keeps the tokens from scripts, and every cookie from other sites', () => {
    expect(cookies[0]).toBe(
      'mb_access=access; Path=/api; Max-Age=900; Secure; SameSite=Strict; HttpOnly',
    );
    expect(cookies[1]).toBe(
      'mb_refresh=refresh; Path=/api/v1/auth; Max-Age=2592000; Secure; SameSite=Strict; HttpOnly',
    );
  });

  it('lets the page read only the CSRF token', () => {
    expect(cookies[2]).toBe('mb_csrf=csrf; Path=/; Max-Age=2592000; Secure; SameSite=Strict');
  });
});

describe('clearSessionCookies', () => {
  it('ends all three at once', () => {
    const cookies = setCookiesOf(clearSessionCookies);
    expect(cookies).toHaveLength(3);
    for (const cookie of cookies) expect(cookie).toContain('Max-Age=0');
  });
});

describe('cookiesOf', () => {
  it('reads a header, and keeps the first of two with one name', () => {
    const cookies = cookiesOf('a=1; b=2=3; a=9; broken; c=');
    expect([...cookies]).toEqual([
      ['a', '1'],
      ['b', '2=3'],
      ['c', ''],
    ]);
  });

  it('has nothing without a header', () => {
    expect(cookiesOf(undefined).size).toBe(0);
    expect(cookiesOf(['a=1']).size).toBe(0);
  });
});

describe('bearerTokenOf', () => {
  it('reads the token', () => {
    expect(bearerTokenOf('Bearer abc.def-g_h')).toBe('abc.def-g_h');
    expect(bearerTokenOf('bearer abc')).toBe('abc');
  });

  it.each(['Basic abc', 'Bearer', 'Bearer a b', ''])('refuses %j', (header) => {
    expect(bearerTokenOf(header)).toBeUndefined();
  });

  it('refuses a repeated header', () => {
    expect(bearerTokenOf(['Bearer a', 'Bearer b'])).toBeUndefined();
    expect(bearerTokenOf(undefined)).toBeUndefined();
  });
});

describe('headerOf', () => {
  it('reads a single value only', () => {
    expect(headerOf('a')).toBe('a');
    expect(headerOf(['a', 'b'])).toBeUndefined();
  });
});

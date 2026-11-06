import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionFetch } from './api.client';

const ME = '/api/v1/me';
const REFRESH = '/api/v1/auth/refresh';

function answer(status: number): Response {
  return new Response(null, { status });
}

describe('sessionFetch', () => {
  const fetchMock = vi.fn<typeof globalThis.fetch>();
  const callsTo = (url: string): number =>
    fetchMock.mock.calls.filter(([input]) => input === url).length;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('document', { cookie: 'other=1; mb_csrf=first' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes on every answer other than a 401', async () => {
    fetchMock.mockResolvedValueOnce(answer(200));
    expect((await sessionFetch(ME)).status).toBe(200);
    expect(callsTo(REFRESH)).toBe(0);
  });

  it('refreshes once, and asks again with the CSRF token of the new session', async () => {
    fetchMock.mockImplementation((input) => {
      if (input === REFRESH) {
        vi.stubGlobal('document', { cookie: 'mb_csrf=second' });
        return Promise.resolve(answer(200));
      }
      return Promise.resolve(answer(callsTo(ME) === 1 ? 401 : 200));
    });
    const response = await sessionFetch(ME, { method: 'PATCH' });
    expect(response.status).toBe(200);
    expect(callsTo(ME)).toBe(2);
    const [, retry] = fetchMock.mock.calls.at(-1) ?? [];
    expect(new Headers(retry?.headers).get('x-csrf-token')).toBe('second');
    expect(retry?.method).toBe('PATCH');
  });

  it('sends the CSRF header with the refresh, which is a cookie request', async () => {
    fetchMock.mockResolvedValue(answer(401));
    await sessionFetch(ME);
    const call = fetchMock.mock.calls.find(([input]) => input === REFRESH);
    expect(new Headers(call?.[1]?.headers).get('x-csrf-token')).toBe('first');
  });

  it('refreshes once for everything that found its token over at the same moment', async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(answer(input === REFRESH ? 200 : callsTo(ME) <= 3 ? 401 : 200)),
    );
    const answers = await Promise.all([sessionFetch(ME), sessionFetch(ME), sessionFetch(ME)]);
    expect(answers.map(({ status }) => status)).toEqual([200, 200, 200]);
    expect(callsTo(REFRESH)).toBe(1);
  });

  it('gives the 401 back when the refresh fails: the session is really over', async () => {
    fetchMock.mockResolvedValue(answer(401));
    expect((await sessionFetch(ME)).status).toBe(401);
    expect(callsTo(ME)).toBe(1);
  });

  it('gives the 401 back when the refresh cannot reach the API', async () => {
    fetchMock.mockImplementation((input) =>
      input === REFRESH ? Promise.reject(new Error('offline')) : Promise.resolve(answer(401)),
    );
    expect((await sessionFetch(ME)).status).toBe(401);
  });

  it('never refreshes for the auth routes: their answers are for the person', async () => {
    fetchMock.mockResolvedValue(answer(401));
    expect((await sessionFetch('/api/v1/auth/login')).status).toBe(401);
    expect(callsTo(REFRESH)).toBe(0);
  });
});

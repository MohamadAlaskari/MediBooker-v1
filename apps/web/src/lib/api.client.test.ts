import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionFetch } from './api.client';

const ME = '/api/v1/me';
const REFRESH = '/api/v1/auth/refresh';
const OTHER_TAB_WAIT_MS = 500;

function answer(status: number): Response {
  return new Response(null, { status });
}

/** Past every wait of the code, for whoever comes to the answer of a request. */
async function settled(request: Promise<Response>): Promise<Response> {
  await vi.runAllTimersAsync();
  return request;
}

describe('sessionFetch', () => {
  const fetchMock = vi.fn<typeof globalThis.fetch>();
  const callsTo = (url: string): number =>
    fetchMock.mock.calls.filter(([input]) => input === url).length;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('document', { cookie: 'other=1; mb_csrf=first' });
  });

  afterEach(() => {
    vi.useRealTimers();
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
    await settled(sessionFetch(ME));
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

  describe('when another tab refreshed the same session first, and its own refresh lost', () => {
    const FROM_THE_OTHER_TAB = 'mb_csrf=from-the-other-tab';

    function otherTabsCookieArrives(afterMs: number): void {
      setTimeout(() => {
        vi.stubGlobal('document', { cookie: FROM_THE_OTHER_TAB });
      }, afterMs);
    }

    it('asks again at once when the cookie came before its own 401', async () => {
      fetchMock
        .mockResolvedValueOnce(answer(401))
        .mockImplementationOnce(() => {
          vi.stubGlobal('document', { cookie: FROM_THE_OTHER_TAB });
          return Promise.resolve(answer(401));
        })
        .mockResolvedValueOnce(answer(200));
      // No timers run here: this order has nothing to wait for.
      expect((await sessionFetch(ME)).status).toBe(200);
      const headers = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
      expect(headers.get('x-csrf-token')).toBe('from-the-other-tab');
    });

    it('still asks again when the cookie came after its own 401', async () => {
      fetchMock
        .mockResolvedValueOnce(answer(401))
        .mockImplementationOnce(() => {
          otherTabsCookieArrives(OTHER_TAB_WAIT_MS - 1);
          return Promise.resolve(answer(401));
        })
        .mockResolvedValueOnce(answer(200));
      expect((await settled(sessionFetch(ME))).status).toBe(200);
      const headers = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
      expect(headers.get('x-csrf-token')).toBe('from-the-other-tab');
    });

    it('does not take a cookie later than the wait for a refresh there', async () => {
      fetchMock.mockImplementation((input) => {
        if (input === REFRESH) otherTabsCookieArrives(OTHER_TAB_WAIT_MS + 1);
        return Promise.resolve(answer(401));
      });
      const request = sessionFetch(ME);
      await vi.advanceTimersByTimeAsync(OTHER_TAB_WAIT_MS);
      expect((await request).status).toBe(401);
      expect(callsTo(ME)).toBe(1);
    });
  });

  it('does not take a sign-out in another tab for a refresh there, and does not wait for one', async () => {
    fetchMock.mockResolvedValueOnce(answer(401)).mockImplementationOnce(() => {
      vi.stubGlobal('document', { cookie: 'other=1' });
      return Promise.resolve(answer(401));
    });
    expect((await sessionFetch(ME)).status).toBe(401);
    expect(callsTo(ME)).toBe(1);
  });

  it('does not keep a visitor without a cookie waiting', async () => {
    vi.stubGlobal('document', { cookie: 'other=1' });
    fetchMock.mockResolvedValue(answer(401));
    expect((await sessionFetch(ME)).status).toBe(401);
  });

  it('gives the 401 back after the wait when the refresh fails: the session is really over', async () => {
    fetchMock.mockResolvedValue(answer(401));
    let answered = false;
    const request = sessionFetch(ME).finally(() => {
      answered = true;
    });
    await vi.advanceTimersByTimeAsync(OTHER_TAB_WAIT_MS - 1);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await request).status).toBe(401);
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

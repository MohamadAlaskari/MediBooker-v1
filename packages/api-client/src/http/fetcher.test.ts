import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiErrorInit } from '../errors/api-error';
import { apiFetch, configureApiClient } from './fetcher';

const PATH = '/api/v1/things';
const BASE_URL = 'http://api.test';
const URL_OF_PATH = `${BASE_URL}${PATH}`;
const REQUEST_ID = '0192f3a0-0000-7000-8000-000000000001';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  configureApiClient({ baseUrl: BASE_URL });
});
afterAll(() => {
  server.close();
});

configureApiClient({ baseUrl: BASE_URL });

function answer(body: BodyInit | null, init: ResponseInit): void {
  server.use(http.all(URL_OF_PATH, () => new HttpResponse(body, init)));
}

async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await promise.then(
    () => {
      throw new Error('The call was expected to fail');
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

function fieldsOf(error: ApiError): ApiErrorInit {
  const { status, code, requestId, params, fieldErrors } = error;
  return { status, code, requestId, params, fieldErrors };
}

describe('apiFetch: success', () => {
  it('resolves with the parsed body', async () => {
    server.use(http.get(URL_OF_PATH, () => HttpResponse.json({ name: 'al-noor' })));
    await expect(apiFetch(PATH)).resolves.toEqual({ name: 'al-noor' });
  });

  it.each([
    [204, null],
    [200, ''],
  ])('resolves with undefined for the empty body of a %i', async (status, body) => {
    answer(body, { status });
    await expect(apiFetch(PATH)).resolves.toBeUndefined();
  });
});

describe('apiFetch: a problem document', () => {
  it('becomes an ApiError with code, params, field errors and request id', async () => {
    answer(
      JSON.stringify({
        type: 'urn:medibooker:problem:validation-failed',
        title: 'Validation failed',
        status: 400,
        detail: 'A detail that screens never show',
        code: 'VALIDATION_FAILED',
        requestId: REQUEST_ID,
        params: { limit: 3 },
        errors: [
          { field: 'items[0].startsAt', code: 'REQUIRED', message: 'Required' },
          { field: 'name', code: 'TOO_LONG', message: 'Too long', params: { max: 80 } },
          { nonsense: true },
          'nonsense',
        ],
      }),
      { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
    );

    const error = await failureOf(apiFetch(PATH));

    expect(fieldsOf(error)).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
      requestId: REQUEST_ID,
      params: { limit: 3 },
      fieldErrors: [
        { field: 'items[0].startsAt', code: 'REQUIRED' },
        { field: 'name', code: 'TOO_LONG', params: { max: 80 } },
      ],
    });
    expect(JSON.stringify(error)).not.toContain('A detail');
    expect(error.message).toBe('VALIDATION_FAILED');
  });

  it('keeps an unknown future code', async () => {
    answer(JSON.stringify({ code: 'SOMETHING_NEW', errors: 'nonsense', params: 'nonsense' }), {
      status: 409,
      headers: { 'Content-Type': 'application/problem+json; charset=utf-8' },
    });

    expect(fieldsOf(await failureOf(apiFetch(PATH)))).toEqual({
      status: 409,
      code: 'SOMETHING_NEW',
      requestId: undefined,
      params: undefined,
      fieldErrors: [],
    });
  });
});

describe('apiFetch: Retry-After', () => {
  const PROBLEM = 'application/problem+json';

  it('is kept on the ApiError of a problem document', async () => {
    answer(JSON.stringify({ code: 'RATE_LIMITED' }), {
      status: 429,
      headers: { 'Content-Type': PROBLEM, 'Retry-After': '60' },
    });

    const error = await failureOf(apiFetch(PATH));

    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryAfterSeconds).toBe(60);
  });

  it('is kept when a proxy answers, too', async () => {
    answer('<html>Busy</html>', {
      status: 503,
      headers: { 'Content-Type': 'text/html', 'Retry-After': '30' },
    });

    const error = await failureOf(apiFetch(PATH));

    expect(error.code).toBe('UNEXPECTED_RESPONSE');
    expect(error.retryAfterSeconds).toBe(30);
  });

  it('is undefined without the header', async () => {
    answer(JSON.stringify({ code: 'RATE_LIMITED' }), {
      status: 429,
      headers: { 'Content-Type': PROBLEM },
    });

    expect((await failureOf(apiFetch(PATH))).retryAfterSeconds).toBeUndefined();
  });

  it.each(['Wed, 21 Oct 2026 07:28:00 GMT', '-1', '1.5', 'soon'])(
    'is undefined for %s, which is no number of whole seconds',
    async (value) => {
      answer(JSON.stringify({ code: 'RATE_LIMITED' }), {
        status: 429,
        headers: { 'Content-Type': PROBLEM, 'Retry-After': value },
      });

      expect((await failureOf(apiFetch(PATH))).retryAfterSeconds).toBeUndefined();
    },
  );
});

describe('apiFetch: anything else', () => {
  it.each([
    ['an HTML 502 from a proxy', '<html>Bad gateway</html>', 502, 'text/html'],
    ['a JSON error that is no problem document', '{"error":"nope"}', 500, 'application/json'],
    ['a problem type without JSON', 'not json', 500, 'application/problem+json'],
    ['a problem document without a code', '{"status":500}', 500, 'application/problem+json'],
    ['a problem document that is no object', '"text"', 500, 'application/problem+json'],
  ])('%s is UNEXPECTED_RESPONSE', async (_, body, status, contentType) => {
    answer(body, {
      status,
      headers: { 'Content-Type': contentType, 'X-Request-Id': REQUEST_ID },
    });

    const error = await failureOf(apiFetch(PATH));

    expect(error.code).toBe('UNEXPECTED_RESPONSE');
    expect(error.status).toBe(status);
    expect(error.requestId).toBe(REQUEST_ID);
  });

  it('a 200 without JSON is UNEXPECTED_RESPONSE', async () => {
    answer('<html>Login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });

    const error = await failureOf(apiFetch(PATH));

    expect(error.code).toBe('UNEXPECTED_RESPONSE');
    expect(error.status).toBe(200);
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it('a rejected fetch is NETWORK_ERROR', async () => {
    server.use(http.get(URL_OF_PATH, () => HttpResponse.error()));

    const error = await failureOf(apiFetch(PATH));

    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.status).toBe(0);
  });

  it('a call past the time limit is TIMEOUT', async () => {
    configureApiClient({ baseUrl: BASE_URL, timeoutMs: 20 });
    server.use(
      http.get(URL_OF_PATH, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );

    const error = await failureOf(apiFetch(PATH));

    expect(error.code).toBe('TIMEOUT');
    expect(error.status).toBe(0);
  });
});

describe('apiFetch: the request', () => {
  it('merges the configured headers with its own, its own winning', async () => {
    const seen = vi.fn<(headers: Headers) => void>();
    server.use(
      http.get(URL_OF_PATH, ({ request }) => {
        seen(request.headers);
        return HttpResponse.json({});
      }),
    );
    configureApiClient({
      baseUrl: BASE_URL,
      getHeaders: () => Promise.resolve({ Authorization: 'Bearer test', 'Accept-Language': 'ar' }),
    });

    await apiFetch(PATH, { headers: { 'Accept-Language': 'en', 'X-Custom': 'yes' } });

    const headers = seen.mock.calls[0]?.[0];
    expect(headers?.get('authorization')).toBe('Bearer test');
    expect(headers?.get('accept-language')).toBe('en');
    expect(headers?.get('x-custom')).toBe('yes');
  });

  it('uses the injected fetch, the base URL and the credentials', async () => {
    const injected = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ ok: true })));
    configureApiClient({
      baseUrl: 'https://example.test',
      credentials: 'include',
      fetch: injected,
    });

    await expect(apiFetch(PATH, { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true });

    const [url, init] = injected.mock.calls[0] ?? [];
    expect(url).toBe(`https://example.test${PATH}`);
    expect(init).toMatchObject({ method: 'POST', body: '{}', credentials: 'include' });
  });

  it('lets a caller override the credentials', async () => {
    const injected = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({})));
    configureApiClient({ credentials: 'include', fetch: injected });

    await apiFetch(PATH, { credentials: 'omit' });

    expect(injected.mock.calls[0]?.[1]?.credentials).toBe('omit');
  });

  it('does not wrap a failure of the header function', async () => {
    const failure = new Error('No token');
    configureApiClient({ getHeaders: () => Promise.reject(failure) });

    await expect(apiFetch(PATH)).rejects.toBe(failure);
  });
});

describe('apiFetch: a cancel by the caller', () => {
  /** A fetch that only ends when its signal aborts, as the real one does on a silent server. */
  const hangingFetch: typeof fetch = (_, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted === true) reject(signal.reason as Error);
      signal?.addEventListener('abort', () => {
        reject(signal.reason as Error);
      });
    });

  async function abortOf(call: Promise<unknown>): Promise<Error> {
    const error: unknown = await call.catch((reason: unknown) => reason);
    expect(error).not.toBeInstanceOf(ApiError);
    return error as Error;
  }

  it('stays an abort when it comes during the request', async () => {
    let requested: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    configureApiClient({
      fetch: (input, init) => {
        requested();
        return hangingFetch(input, init);
      },
    });
    const controller = new AbortController();

    const call = apiFetch(PATH, { signal: controller.signal });
    await started;
    controller.abort();

    expect((await abortOf(call)).name).toBe('AbortError');
  });

  it('stays an abort when the signal was aborted before the call', async () => {
    configureApiClient({ fetch: hangingFetch });

    const error = await abortOf(apiFetch(PATH, { signal: AbortSignal.abort() }));

    expect(error.name).toBe('AbortError');
  });
});

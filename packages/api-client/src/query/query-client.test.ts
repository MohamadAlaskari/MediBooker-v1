import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import type { QueryClient } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors/api-error';
import { getGetPublicPracticeQueryOptions, useGetPublicPractice } from '../generated/endpoints';
import { configureApiClient } from '../http/fetcher';
import { getGetPublicPracticeMockHandler, getGetPublicPracticeResponseMock } from '../mocks';
import { GetPublicPracticeResponse } from '../zod';
import { createQueryClient, createTestQueryClient, shouldRetryQuery } from './query-client';

describe('shouldRetryQuery', () => {
  const error = (status: number, code: string) => new ApiError({ status, code });

  it.each([
    ['a lost connection', error(0, 'NETWORK_ERROR')],
    ['a timeout', error(0, 'TIMEOUT')],
    ['a server failure', error(500, 'INTERNAL_ERROR')],
    ['a practice that is unavailable', error(503, 'SERVICE_UNAVAILABLE')],
    ['a proxy failure', error(502, 'UNEXPECTED_RESPONSE')],
  ])('retries %s at most twice', (_, failure) => {
    expect(shouldRetryQuery(0, failure)).toBe(true);
    expect(shouldRetryQuery(1, failure)).toBe(true);
    expect(shouldRetryQuery(2, failure)).toBe(false);
  });

  it.each([
    ['a validation failure', error(400, 'VALIDATION_FAILED')],
    ['a missing sign-in', error(401, 'UNAUTHENTICATED')],
    ['a missing permission', error(403, 'FORBIDDEN')],
    ['an unknown resource', error(404, 'NOT_FOUND')],
    ['a conflict', error(409, 'CONFLICT')],
    ['a rate limit', error(429, 'RATE_LIMITED')],
    ['a bug in the client', new TypeError('x is not a function')],
  ])('never retries %s', (_, failure) => {
    expect(shouldRetryQuery(0, failure)).toBe(false);
  });
});

describe('createQueryClient', () => {
  it('sets the retry rule, the stale time and no mutation retries', () => {
    const { queries, mutations } = createQueryClient().getDefaultOptions();
    expect(queries?.retry).toBe(shouldRetryQuery);
    expect(queries?.staleTime).toBe(30_000);
    expect(mutations?.retry).toBe(false);
  });
});

describe('a session that is over', () => {
  const over = new ApiError({ status: 401, code: 'UNAUTHENTICATED' });
  const wrongPassword = new ApiError({ status: 401, code: 'INVALID_CREDENTIALS' });

  const failQuery = (client: QueryClient, error: Error): Promise<unknown> =>
    client
      .query({ queryKey: ['a query'], queryFn: () => Promise.reject(error) })
      .catch(() => undefined);

  const failMutation = (client: QueryClient, error: Error): Promise<unknown> =>
    client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(error) })
      .execute(undefined)
      .catch(() => undefined);

  it.each([
    ['a query', failQuery],
    ['a press', failMutation],
  ])('is reported when %s finds out', async (_, fail) => {
    const onUnauthenticated = vi.fn();
    await fail(createQueryClient({ onUnauthenticated }), over);
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it.each([
    ['a query', failQuery],
    ['a press', failMutation],
  ])('is not what any other failure of %s means, a wrong password included', async (_, fail) => {
    const onUnauthenticated = vi.fn();
    const client = createQueryClient({ onUnauthenticated });
    await fail(client, wrongPassword);
    await fail(client, new ApiError({ status: 404, code: 'NOT_FOUND' }));
    await fail(client, new TypeError('x is not a function'));
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('passes unnoticed on a client that did not ask, as on a public page', async () => {
    const client = createQueryClient();
    await expect(failQuery(client, over)).resolves.toBeUndefined();
    await expect(failMutation(client, over)).resolves.toBeUndefined();
  });
});

describe('createTestQueryClient', () => {
  it('keeps the retry rule without the waiting', () => {
    const { queries, mutations } = createTestQueryClient().getDefaultOptions();
    expect(queries?.retry).toBe(shouldRetryQuery);
    expect(queries?.retryDelay).toBe(0);
    expect(queries?.gcTime).toBe(Infinity);
    expect(mutations?.retry).toBe(false);
  });
});

describe('the generated client against the generated mocks', () => {
  const server = setupServer();
  const BASE_URL = 'http://api.test';

  beforeAll(() => {
    server.listen({ onUnhandledFrame: 'error' });
    configureApiClient({ baseUrl: BASE_URL });
  });
  afterEach(() => {
    server.resetHandlers();
  });
  afterAll(() => {
    server.close();
    configureApiClient({});
  });

  it('exports the hook', () => {
    expect(useGetPublicPractice).toBeTypeOf('function');
  });

  it('a query reads the mock, and the zod schema accepts the answer', async () => {
    const practice = getGetPublicPracticeResponseMock({ slug: 'al-noor' });
    server.use(getGetPublicPracticeMockHandler(practice));

    const data = await createTestQueryClient().query(getGetPublicPracticeQueryOptions('al-noor'));

    expect(data.slug).toBe('al-noor');
    expect(GetPublicPracticeResponse.safeParse(data).success).toBe(true);
  });

  it('sends the declared language header', async () => {
    let language: string | null = null;
    server.use(
      getGetPublicPracticeMockHandler(({ request }) => {
        language = request.headers.get('accept-language');
        return getGetPublicPracticeResponseMock();
      }),
    );

    await createTestQueryClient().query(
      getGetPublicPracticeQueryOptions('al-noor', { 'Accept-Language': 'en' }),
    );

    expect(language).toBe('en');
  });

  it('a 404 fails at once with an ApiError, without retries', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE_URL}/api/v1/public/practices/:slug`, () => {
        calls += 1;
        return HttpResponse.json(
          { code: 'NOT_FOUND', requestId: 'r-1' },
          { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }),
    );

    await expect(
      createTestQueryClient().query(getGetPublicPracticeQueryOptions('nobody')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(calls).toBe(1);
  });

  it('a 503 is tried three times in all', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE_URL}/api/v1/public/practices/:slug`, () => {
        calls += 1;
        return HttpResponse.json(
          { code: 'SERVICE_UNAVAILABLE' },
          { status: 503, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }),
    );

    await expect(
      createTestQueryClient().query({
        ...getGetPublicPracticeQueryOptions('al-noor'),
        retry: shouldRetryQuery,
      }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(calls).toBe(3);
  });
});

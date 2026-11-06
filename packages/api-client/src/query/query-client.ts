import { QueryClient } from '@tanstack/react-query';
import { isApiError } from '../errors/api-error';

const MAX_QUERY_RETRIES = 2;
const QUERY_STALE_TIME_MS = 30_000;

/**
 * Queries retry only what may pass on a second try: a lost connection, a timeout or a server
 * failure, a 503 of one practice included. Never a 4xx, so 429 is not retried either (05 §1.6).
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES || !isApiError(error)) return false;
  return error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT' || error.status >= 500;
}

/** Mutations never retry on their own: a booking retry is the user's, with the same key. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: QUERY_STALE_TIME_MS, retry: shouldRetryQuery },
      mutations: { retry: false },
    },
  });
}

/** The same rules without the waiting, and without a garbage-collection timer left running. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery, retryDelay: 0, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

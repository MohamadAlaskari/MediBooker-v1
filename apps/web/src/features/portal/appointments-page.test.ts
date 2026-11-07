import { ApiError } from '@medibooker/api-client';
import { describe, expect, it } from 'vitest';
import { fanOutRetryDelay, retryFanOut } from './appointments-page';

/** The default of the API's `ME_FANOUT_TIMEOUT_MS`. */
const FAN_OUT_TIMEOUT_MS = 2000;

const limited = (retryAfterSeconds?: number): ApiError =>
  new ApiError({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds });

/** How long a page asks again for this error, as TanStack Query goes through the two functions. */
function msAskingAgain(error: unknown): number {
  let waited = 0;
  for (let failures = 0; retryFanOut(failures, error); failures += 1) {
    expect(failures).toBeLessThan(10);
    waited += fanOutRetryDelay(failures, error);
  }
  return waited;
}

describe('asking again for the upcoming appointments', () => {
  it('outlasts a fan-out of another tab, which holds its place for two timeouts at most', () => {
    expect(msAskingAgain(limited(1))).toBeGreaterThan(2 * FAN_OUT_TIMEOUT_MS);
  });

  it('asks again a second apart when the wait is that short, and then stops', () => {
    const error = limited(1);
    expect(fanOutRetryDelay(0, error)).toBe(1000);
    expect(retryFanOut(4, error)).toBe(true);
    expect(retryFanOut(5, error)).toBe(false);
  });

  it('waits as long as the API says, up to 5 seconds', () => {
    expect(retryFanOut(0, limited(5))).toBe(true);
    expect(fanOutRetryDelay(0, limited(5))).toBe(5000);
  });

  it.each([
    ['a throttle', limited(60)],
    ['just above the short wait', limited(6)],
    [
      'a server asking for half a minute',
      new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE', retryAfterSeconds: 30 }),
    ],
  ])('shows the error at once and spends no request after a long wait: %s', (_, error) => {
    expect(retryFanOut(0, error)).toBe(false);
  });

  it('never asks again at once, whatever the header says', () => {
    expect(fanOutRetryDelay(0, limited(0))).toBe(1000);
  });

  it('takes a limit that names no wait as any 429: not worth asking again', () => {
    expect(retryFanOut(0, limited())).toBe(false);
  });

  it.each([
    ['a lost connection', new ApiError({ status: 0, code: 'NETWORK_ERROR' })],
    ['a timeout', new ApiError({ status: 0, code: 'TIMEOUT' })],
    ['a server failure', new ApiError({ status: 500, code: 'INTERNAL_ERROR' })],
    [
      'a short 503',
      new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE', retryAfterSeconds: 2 }),
    ],
  ])('asks twice again after %s, as any query does', (_, error) => {
    expect(retryFanOut(1, error)).toBe(true);
    expect(retryFanOut(2, error)).toBe(false);
  });

  it('does not ask again for what will not pass', () => {
    expect(retryFanOut(0, new ApiError({ status: 401, code: 'UNAUTHENTICATED' }))).toBe(false);
    expect(retryFanOut(0, new Error('not from the API'))).toBe(false);
  });

  it('waits a second when nothing says how long', () => {
    expect(fanOutRetryDelay(0, new ApiError({ status: 500, code: 'INTERNAL_ERROR' }))).toBe(1000);
    expect(fanOutRetryDelay(0, new Error('not from the API'))).toBe(1000);
  });
});

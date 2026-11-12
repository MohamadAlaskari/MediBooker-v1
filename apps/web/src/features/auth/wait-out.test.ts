import { ApiError } from '@medibooker/api-client';
import { describe, expect, it } from 'vitest';
import { waitOf } from './wait-out';

describe('waitOf (B06)', () => {
  it('waits out the Retry-After of a throttle and of a busy practice', () => {
    expect(waitOf(new ApiError({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 7 }))).toBe(
      7,
    );
    expect(
      waitOf(new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE', retryAfterSeconds: 30 })),
    ).toBe(30);
  });

  it('waits two minutes at most: longer, the button would look broken', () => {
    expect(
      waitOf(new ApiError({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 3600 })),
    ).toBe(120);
  });

  it.each([
    ['no error', null],
    ['an error not from the API', new Error('lost')],
    ['an answer without a Retry-After', new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE' })],
    [
      'a wait that a page says in words',
      new ApiError({ status: 429, code: 'JOIN_LIMIT_REACHED', retryAfterSeconds: 86_400 }),
    ],
    [
      'a refusal that waiting does not change',
      new ApiError({ status: 409, code: 'SLOT_NOT_AVAILABLE', retryAfterSeconds: 5 }),
    ],
    [
      'a wait of nothing',
      new ApiError({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 0 }),
    ],
  ])('waits for nothing after %s', (_name, error) => {
    expect(waitOf(error)).toBeUndefined();
  });
});

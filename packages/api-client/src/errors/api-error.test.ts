import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../generated/model';
import { ApiError, applyFieldErrors, errorMessageKey, isApiError } from './api-error';

describe('isApiError', () => {
  it('narrows by class and, when given, by code', () => {
    const error = new ApiError({ status: 404, code: 'NOT_FOUND' });
    expect(isApiError(error)).toBe(true);
    expect(isApiError(error, 'NOT_FOUND')).toBe(true);
    expect(isApiError(error, 'CONFLICT')).toBe(false);
    expect(isApiError(new Error('NOT_FOUND'))).toBe(false);
    expect(isApiError(undefined)).toBe(false);
  });
});

describe('errorMessageKey', () => {
  it.each(['NOT_FOUND', 'VALIDATION_FAILED', 'NETWORK_ERROR', 'TIMEOUT', 'UNEXPECTED_RESPONSE'])(
    'uses the key of the known code %s',
    (code) => {
      expect(errorMessageKey(new ApiError({ status: 400, code }))).toBe(`errors.${code}`);
    },
  );

  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [429, 'RATE_LIMITED'],
    [500, 'INTERNAL_ERROR'],
    [503, 'INTERNAL_ERROR'],
    [400, 'UNEXPECTED_RESPONSE'],
    [422, 'UNEXPECTED_RESPONSE'],
  ])('keeps a code from a newer server and falls back by status %i', (status, fallback) => {
    const error = new ApiError({ status, code: 'SOMETHING_NEW' });
    expect(error.code).toBe('SOMETHING_NEW');
    expect(errorMessageKey(error)).toBe(`errors.${fallback}`);
  });
});

describe('applyFieldErrors', () => {
  it('maps nested paths and returns true', () => {
    const setError = vi.fn();
    const error = new ApiError({
      status: 400,
      code: 'VALIDATION_FAILED',
      fieldErrors: [
        { field: 'items[0].startsAt', code: 'REQUIRED' },
        { field: 'matrix[1][2]', code: 'TOO_LARGE', params: { max: 5 } },
        { field: 'email', code: 'INVALID_FORMAT' },
      ],
    });

    expect(applyFieldErrors(error, setError)).toBe(true);
    expect(setError.mock.calls).toEqual([
      ['items.0.startsAt', { type: 'REQUIRED', message: 'validation.REQUIRED' }],
      ['matrix.1.2', { type: 'TOO_LARGE', message: 'validation.TOO_LARGE' }],
      ['email', { type: 'INVALID_FORMAT', message: 'validation.INVALID_FORMAT' }],
    ]);
  });

  it('returns false when there are no field errors', () => {
    const setError = vi.fn();
    expect(applyFieldErrors(new ApiError({ status: 409, code: 'CONFLICT' }), setError)).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });
});

describe('the contract', () => {
  it('knows the codes of the server catalogue', () => {
    const document = JSON.parse(
      readFileSync(new URL('../../../../apps/api/openapi.json', import.meta.url), 'utf8'),
    ) as { components: { schemas: { ErrorCode: { enum: string[] } } } };
    expect(Object.values(ErrorCode)).toEqual(document.components.schemas.ErrorCode.enum);
  });
});

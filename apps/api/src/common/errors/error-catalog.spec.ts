import { describe, expect, it } from 'vitest';
import { ERROR_CATALOG, ERROR_CODES, errorCodeOfStatus, problemTypeOf } from './error-catalog.js';

describe('the error catalogue (05 §1.1)', () => {
  it('has UPPER_SNAKE codes, error statuses and a title for every code', () => {
    for (const code of ERROR_CODES) {
      const { status, title } = ERROR_CATALOG[code];
      expect(code).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
      expect(title).not.toBe('');
    }
  });

  it('writes a code as a URN', () => {
    expect(problemTypeOf('SERVICE_UNAVAILABLE')).toBe('urn:medibooker:problem:service-unavailable');
  });

  it.each([
    [400, 'VALIDATION_FAILED'],
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [429, 'RATE_LIMITED'],
    [503, 'SERVICE_UNAVAILABLE'],
    [418, 'VALIDATION_FAILED'],
    [500, 'INTERNAL_ERROR'],
    [502, 'INTERNAL_ERROR'],
  ] as const)('maps the status %i to %s by status only', (status, code) => {
    expect(errorCodeOfStatus(status)).toBe(code);
  });
});

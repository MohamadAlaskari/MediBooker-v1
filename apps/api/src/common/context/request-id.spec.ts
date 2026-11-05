import { describe, expect, it } from 'vitest';
import { requestIdOf, type IdentifiableRequest } from './request-id.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requestWith(header?: string | string[]): IdentifiableRequest {
  return { headers: header === undefined ? {} : { 'x-request-id': header } };
}

describe('requestIdOf', () => {
  it('keeps an inbound id in the 8-4-4-4-12 hex form', () => {
    const id = '0b5c1f3e-9a2d-4c6b-8e7f-1a2b3c4d5e6f';
    expect(requestIdOf(requestWith(id))).toBe(id);
  });

  it('stores an uppercase inbound id in lowercase', () => {
    expect(requestIdOf(requestWith('0B5C1F3E-9A2D-4C6B-8E7F-1A2B3C4D5E6F'))).toBe(
      '0b5c1f3e-9a2d-4c6b-8e7f-1a2b3c4d5e6f',
    );
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'secret-value'],
    ['too long', '0b5c1f3e-9a2d-4c6b-8e7f-1a2b3c4d5e6f0'],
    [
      'joined by Node from repeated headers',
      '0b5c1f3e-9a2d-4c6b-8e7f-1a2b3c4d5e6f, 0b5c1f3e-9a2d-4c6b-8e7f-1a2b3c4d5e6f',
    ],
    ['an array', ['0b5c1f3e-9a2d-4c6b-8e7f-1a2b3c4d5e6f']],
  ])('replaces a %s id with a new UUID', (_case, header) => {
    const id = requestIdOf(requestWith(header));
    expect(id).toMatch(UUID_V4);
    expect(id).not.toBe(header);
  });

  it('computes the id once per request and stores it on req.id', () => {
    const req = requestWith();
    const first = requestIdOf(req);
    expect(req.id).toBe(first);
    expect(requestIdOf(req)).toBe(first);
  });
});

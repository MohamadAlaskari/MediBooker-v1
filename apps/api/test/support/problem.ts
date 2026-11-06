import type { Response } from 'supertest';
import { expect } from 'vitest';

/**
 * A problem body without its request id, which differs per request: what must be identical for an
 * unknown, an unpublished and a provisioning practice, so a response never tells them apart.
 */
export function problemWithoutRequestId(response: Response): Record<string, unknown> {
  const problem = JSON.parse(response.text) as Record<string, unknown>;
  expect(problem.requestId).toEqual(expect.any(String));
  return { ...problem, requestId: undefined };
}

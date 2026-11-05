import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { UUID } from '../support/patterns.js';
import { ProbeModule } from '../support/probe.module.js';

const PROTECTED = '/api/v1/probe/protected/1';
const FOUR_ADDRESSES = ['203.0.113.1', '203.0.113.2', '203.0.113.3', '203.0.113.4'];

/**
 * Buckets are per route and address and live in the app, so every case builds its own app with a
 * limit of 3 per minute and closes it again.
 */
async function withThrottledApp(
  env: Readonly<Record<string, string>>,
  run: (app: NestExpressApplication) => Promise<void>,
): Promise<void> {
  const app = await createTestApp({
    env: { RATE_LIMIT_PER_MINUTE: '3', ...env },
    imports: [ProbeModule],
  });
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

/** Sends `count` GET requests one after another, each with the next X-Forwarded-For value if any. */
async function statusesOf(
  app: NestExpressApplication,
  path: string,
  count: number,
  forwardedFor: readonly string[] = [],
): Promise<number[]> {
  const statuses: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const address = forwardedFor[index];
    const call = request(app.getHttpServer()).get(path);
    const response = await (address === undefined ? call : call.set('X-Forwarded-For', address));
    statuses.push(response.status);
  }
  return statuses;
}

describe('throttling with a limit of 3 per minute (02 §4)', () => {
  it('answers the fourth request with 429 and a Retry-After of at most one minute, before authentication', async () => {
    await withThrottledApp({}, async (app) => {
      expect(await statusesOf(app, PROTECTED, 3)).toEqual([401, 401, 401]);
      const throttled = await request(app.getHttpServer()).get(PROTECTED);
      expect(throttled.status).toBe(429);
      expect(throttled.headers['retry-after']).toMatch(/^\d+$/);
      const retryAfter = Number(throttled.headers['retry-after']);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(60);
      expect(throttled.headers['x-request-id']).toMatch(UUID);
    });
  });

  it('counts per route: another route of the same address is not throttled', async () => {
    await withThrottledApp({}, async (app) => {
      expect(await statusesOf(app, PROTECTED, 4)).toEqual([401, 401, 401, 429]);
      expect(await statusesOf(app, '/api/v1/probe/context', 1)).toEqual([200]);
    });
  });

  it('keys by the socket address with TRUST_PROXY_HOPS=0: a forged X-Forwarded-For opens no new bucket', async () => {
    await withThrottledApp({ TRUST_PROXY_HOPS: '0' }, async (app) => {
      expect(await statusesOf(app, PROTECTED, 4, FOUR_ADDRESSES)).toEqual([401, 401, 401, 429]);
    });
  });

  it('keys by the forwarded address with TRUST_PROXY_HOPS=1, so the setting is wired', async () => {
    await withThrottledApp({ TRUST_PROXY_HOPS: '1' }, async (app) => {
      expect(await statusesOf(app, PROTECTED, 4, FOUR_ADDRESSES)).toEqual([401, 401, 401, 401]);
    });
  });

  it('never throttles the liveness probe', async () => {
    await withThrottledApp({}, async (app) => {
      expect(await statusesOf(app, '/health/live', 5)).toEqual([200, 200, 200, 200, 200]);
    });
  });
});

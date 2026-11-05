import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { captureLogs } from '../support/log-capture.js';
import { PracticeProbeModule } from '../support/practice-probe.module.js';
import { ProbeModule } from '../support/probe.module.js';

/** Connection details of TEST_ENV's refused platform database, which no line may show. */
const CONNECTION_DETAILS = /127\.0\.0\.1:9|test:test|\/none/;

/**
 * The @PracticeScoped mechanism without a database (02 §5): the integration specs cover the
 * registry, the status table, the leases and the isolation between practices.
 */
describe('@PracticeScoped routes without a database', () => {
  const logs = captureLogs();
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({
      imports: [ProbeModule, PracticeProbeModule],
      logDestination: logs,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['not-a-uuid', '00000000-0000-4000-8000-00000000000', 'secret-value'])(
    'answers 404 for the practice id %s before it reads the registry',
    async (practiceId) => {
      const id = randomUUID();
      await request(app.getHttpServer())
        .get(`/api/v1/practices/${practiceId}/probe/identity`)
        .set('X-Request-Id', id)
        .expect(404);
      await logs.waitForAccessLine(id);
      // A registry read against the refused database would log Prisma's error event.
      expect(
        logs.lines().filter((line) => line.reqId === id && line.responseTime === undefined),
      ).toEqual([]);
      expect(logs.text()).not.toContain('secret-value');
    },
  );

  it('reads the registry for a UUID: the refused platform database fails the request without a connection detail in the logs', async () => {
    const id = randomUUID();
    const response = await request(app.getHttpServer())
      .get(`/api/v1/practices/${randomUUID()}/probe/identity`)
      .set('X-Request-Id', id);
    expect(response.status).toBe(500);
    await logs.waitForAccessLine(id);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({
        reqId: id,
        msg: 'unknown exception',
        err: expect.objectContaining({ type: 'PrismaClientKnownRequestError' }) as unknown,
      }),
    );
    expect(logs.text()).not.toMatch(CONNECTION_DETAILS);
    expect(response.text).not.toMatch(CONNECTION_DETAILS);
  });

  it('leaves a route without @PracticeScoped alone: it never resolves a practice', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/context');
    expect(response.status).toBe(200);
  });
});

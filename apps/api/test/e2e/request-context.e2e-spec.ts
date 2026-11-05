import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { captureLogs } from '../support/log-capture.js';
import { UUID } from '../support/patterns.js';
import { ProbeModule } from '../support/probe.module.js';

describe('request id', () => {
  const logs = captureLogs();
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ imports: [ProbeModule], logDestination: logs });
  });

  afterAll(async () => {
    await app.close();
  });

  it('echoes an inbound UUID X-Request-Id', async () => {
    const id = randomUUID();
    const response = await request(app.getHttpServer()).get('/health/live').set('X-Request-Id', id);
    expect(response.headers['x-request-id']).toBe(id);
  });

  it('keeps an uppercase inbound id in lowercase', async () => {
    const id = randomUUID();
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Request-Id', id.toUpperCase());
    expect(response.headers['x-request-id']).toBe(id);
  });

  it('replaces an invalid X-Request-Id with a new UUID', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Request-Id', 'secret-value');
    expect(response.headers['x-request-id']).toMatch(UUID);
  });

  it.each([
    ['an unknown route', '/nope', 404],
    ['a route without @Public()', '/api/v1/probe/protected/1', 401],
  ])('sets X-Request-Id on %s', async (_case, path, status) => {
    const response = await request(app.getHttpServer()).get(path).expect(status);
    expect(response.headers['x-request-id']).toMatch(UUID);
  });

  it('gives the request context, the response header and the access log the same id', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/context').expect(200);
    const id = String(response.headers['x-request-id']);
    expect(id).toMatch(UUID);
    expect(response.body).toEqual({ requestId: id });
    expect(await logs.waitForAccessLine(id)).toMatchObject({ reqId: id, req: { id } });
  });
});

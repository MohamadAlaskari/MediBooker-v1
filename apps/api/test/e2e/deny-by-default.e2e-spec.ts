import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { ProbeModule } from '../support/probe.module.js';

describe('deny by default', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ imports: [ProbeModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 401 for a route without @Public()', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/protected/1');
    expect(response.status).toBe(401);
    expect(response.body).not.toHaveProperty('id');
  });

  it('answers 401 also with a bearer token: no token is accepted before A01', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/protected/1')
      .set('Authorization', 'Bearer secret-value');
    expect(response.status).toBe(401);
  });

  it('opens a route marked @Public()', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/context');
    expect(response.status).toBe(200);
  });

  it('answers 401 for a handler marked with SetMetadata and the former string key: the marker is no metadata', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/string-key-marked');
    expect(response.status).toBe(401);
    expect(response.body).not.toHaveProperty('isReachable');
  });

  it.each(['/nope', '/api/v1/nope'])('answers 404 for the unknown route %s', async (path) => {
    const response = await request(app.getHttpServer()).get(path);
    expect(response.status).toBe(404);
  });
});

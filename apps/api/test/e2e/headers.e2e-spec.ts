import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';

const WEB_ORIGIN = 'https://web.example.test';
const OTHER_ORIGIN = 'https://evil.example.test';

describe('helmet', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['a matched route', '/health/live'],
    ['an unknown route', '/nope'],
  ])('sets the security headers on %s', async (_case, path) => {
    const response = await request(app.getHttpServer()).get(path);
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(response.headers['strict-transport-security']).toMatch(/^max-age=\d+/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers).not.toHaveProperty('x-powered-by');
  });
});

describe('CORS', () => {
  describe('without CORS_ORIGINS', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('sends no Access-Control-Allow-Origin, also not to a preflight', async () => {
      const simple = await request(app.getHttpServer())
        .get('/health/live')
        .set('Origin', WEB_ORIGIN);
      expect(simple.headers).not.toHaveProperty('access-control-allow-origin');
      const preflight = await request(app.getHttpServer())
        .options('/health/live')
        .set('Origin', WEB_ORIGIN)
        .set('Access-Control-Request-Method', 'GET');
      expect(preflight.headers).not.toHaveProperty('access-control-allow-origin');
    });
  });

  describe(`with CORS_ORIGINS=${WEB_ORIGIN}`, () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createTestApp({ env: { CORS_ORIGINS: WEB_ORIGIN } });
    });

    afterAll(async () => {
      await app.close();
    });

    it('allows the listed origin and exposes X-Request-Id and Retry-After', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/live')
        .set('Origin', WEB_ORIGIN);
      expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
      expect(response.headers['access-control-expose-headers']).toBe('X-Request-Id,Retry-After');
    });

    it('answers a preflight of the listed origin', async () => {
      const response = await request(app.getHttpServer())
        .options('/health/live')
        .set('Origin', WEB_ORIGIN)
        .set('Access-Control-Request-Method', 'GET');
      expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('sends no Access-Control-Allow-Origin to another origin', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/live')
        .set('Origin', OTHER_ORIGIN);
      expect(response.headers).not.toHaveProperty('access-control-allow-origin');
    });
  });
});

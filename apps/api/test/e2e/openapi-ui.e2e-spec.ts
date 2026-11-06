import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';

describe('the Swagger UI (02 §11)', () => {
  describe('by default', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('does not exist', async () => {
      expect((await request(app.getHttpServer()).get('/api/docs')).status).toBe(404);
      expect((await request(app.getHttpServer()).get('/api/docs-json')).status).toBe(404);
    });

    it('keeps the strict Content-Security-Policy of the JSON API', async () => {
      const response = await request(app.getHttpServer()).get('/health/live').expect(200);
      expect(response.headers['content-security-policy']).toBe(
        "default-src 'none';frame-ancestors 'none'",
      );
    });
  });

  describe('with OPENAPI_UI_ENABLED', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createTestApp({ env: { OPENAPI_UI_ENABLED: 'true' } });
    });

    afterAll(async () => {
      await app.close();
    });

    it('serves the UI with a CSP that lets it run, and the document', async () => {
      const page = await request(app.getHttpServer()).get('/api/docs/').expect(200);
      expect(page.text).toContain('swagger');
      expect(page.headers['content-security-policy']).toContain("default-src 'self'");
      const document = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
      expect(document.body).toMatchObject({ openapi: '3.1.0' });
    });

    it('keeps the strict Content-Security-Policy everywhere else', async () => {
      const response = await request(app.getHttpServer()).get('/health/live').expect(200);
      expect(response.headers['content-security-policy']).toBe(
        "default-src 'none';frame-ancestors 'none'",
      );
    });
  });
});

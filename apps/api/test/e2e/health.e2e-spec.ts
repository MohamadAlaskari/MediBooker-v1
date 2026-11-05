import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { captureLogs } from '../support/log-capture.js';

describe('health probes', () => {
  const logs = captureLogs();
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ logDestination: logs });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health/live', () => {
    it('RT-69 answers 200 with exactly {"status":"ok"}, outside /api and without a version', async () => {
      const response = await request(app.getHttpServer()).get('/health/live');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.text).toBe('{"status":"ok"}');
    });

    it.each(['/v1/health/live', '/api/v1/health/live'])('RT-69 %s answers 404', async (path) => {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.status).toBe(404);
    });

    it('RT-69 the boot log maps the probe and has no "Unsupported route path" warning', () => {
      // Positive control: the capture holds the boot log.
      expect(logs.text()).toContain('Mapped {/health/live, GET}');
      expect(logs.text()).not.toContain('Unsupported route path');
    });
  });

  describe('GET /health/ready (F04, 02 §10)', () => {
    it('answers 503 while the platform database refuses connections, without a detail of it', async () => {
      // TEST_ENV's platform database is a port that refuses every connection.
      const response = await request(app.getHttpServer()).get('/health/ready');
      expect(response.status).toBe(503);
      expect(response.text).not.toMatch(/127\.0\.0\.1|:9\b|test:test|none/);
    });

    it.each(['/v1/health/ready', '/api/v1/health/ready'])('%s answers 404', async (path) => {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.status).toBe(404);
    });

    it('is not logged; a later request to the same app is', async () => {
      const probeId = randomUUID();
      const controlId = randomUUID();
      await request(app.getHttpServer())
        .get('/health/ready?probe=1')
        .set('X-Request-Id', probeId)
        .expect(503);
      await request(app.getHttpServer()).get('/nope').set('X-Request-Id', controlId).expect(404);
      // The control request finished after the probe, so a probe access line would be there.
      await logs.waitForAccessLine(controlId);
      expect(
        logs.lines().filter((line) => line.responseTime !== undefined && line.reqId === probeId),
      ).toEqual([]);
    });
  });
});

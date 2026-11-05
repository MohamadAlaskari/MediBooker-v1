import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { captureLogs } from '../support/log-capture.js';

describe('GET /health/live', () => {
  const logs = captureLogs();
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ logDestination: logs });
  });

  afterAll(async () => {
    await app.close();
  });

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

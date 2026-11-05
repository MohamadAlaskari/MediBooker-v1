/**
 * Readiness against a real platform database (02 §10): `GET /health/ready` answers 200 when the
 * platform database answers and its schema has reached PLATFORM_SCHEMA_REQUIRED (read through
 * platform_app's guarded grant on `_prisma_migrations`, 02 §9), and 503 when the database it names
 * is missing on a reachable server. test/e2e/health.e2e-spec.ts covers a refused port.
 */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { usePracticeDatabases } from '../support/practices.js';

describe('GET /health/ready with the platform database (02 §10)', () => {
  const databases = usePracticeDatabases({ practices: 'none' });
  const apps: NestExpressApplication[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function readiness(env: Readonly<Record<string, string>>): Promise<unknown> {
    const app = await createTestApp({ env });
    apps.push(app);
    const response = await request(app.getHttpServer()).get('/health/ready');
    return { status: response.status, body: response.text };
  }

  it('08 F04 answers 200 with the platform database at the current schema version', async () => {
    expect(await readiness(databases.apiEnv)).toEqual({ status: 200, body: '{"status":"ok"}' });
  });

  it('08 F04 answers 503 when the platform database is missing on a reachable server', async () => {
    const missing = new URL(databases.platformAppUrl);
    missing.pathname = `/platform_missing_${randomUUID().replaceAll('-', '')}`;
    expect(
      await readiness({ ...databases.apiEnv, PLATFORM_DATABASE_URL: missing.toString() }),
    ).toEqual({
      status: 503,
      body: '{"message":"Service Unavailable","statusCode":503}',
    });
  });
});

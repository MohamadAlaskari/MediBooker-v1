import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { captureLogs } from '../support/log-capture.js';
import { UUID } from '../support/patterns.js';
import { ProbeModule } from '../support/probe.module.js';

function jsonOfLength(bytes: number): string {
  const body = JSON.stringify({ data: '' });
  return JSON.stringify({ data: 'x'.repeat(bytes - body.length) });
}

/** Synthetic markers in request bodies; the body parsers' error messages quote the body. */
const MARKERS = /secret-value|sara@example\.test/;

describe('body parsers (02 §3 step 7)', () => {
  const logs = captureLogs();
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ imports: [ProbeModule], logDestination: logs });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a JSON body over 100 kB with 413 and a UUID X-Request-Id', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send(jsonOfLength(100 * 1024 + 1));
    expect(response.status).toBe(413);
    expect(response.headers['x-request-id']).toMatch(UUID);
  });

  it('lets a body of exactly 100 kB through to routing (here: 404)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send(jsonOfLength(100 * 1024));
    expect(response.status).toBe(404);
  });

  it('parses JSON and refuses a urlencoded form: the urlencoded parser stays off', async () => {
    const server = app.getHttpServer();
    const json = await request(server)
      .post('/api/v1/probe/body')
      .set('Content-Type', 'application/json')
      .send('{"note":"x"}');
    expect(json.body).toEqual({ bodyType: 'object' });
    const form = await request(server)
      .post('/api/v1/probe/body')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('email=sara%40example.test');
    expect(form.status).toBe(415);
  });

  it.each([
    ['a key the validation pipe would read as a class', '{"note":{"constructor":"x"}}'],
    ['a body nested deeper than any of the API', `${'['.repeat(40)}${']'.repeat(40)}`],
  ])('answers 400, not 500, for %s (security review of M02)', async (_case, body) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/probe/body')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(response.status).toBe(400);
  });

  it.each([
    ['malformed JSON', 400, '{"email": "sara@example.test",'],
    ['JSON that strict mode refuses', 400, '"sara@example.test secret-value"'],
    [
      'a body over the limit',
      413,
      jsonOfLength(100 * 1024 + 1).replace('xxxx', 'sara@example.test'),
    ],
  ])(
    'logs no line for %s: the parser answers before the access log, and 4xx is not logged',
    async (_case, status, body) => {
      const server = app.getHttpServer();
      const rejectedId = randomUUID();
      await request(server)
        .post('/api/v1/probe/body')
        .set('Content-Type', 'application/json')
        .set('X-Request-Id', rejectedId)
        .send(body)
        .expect(status);
      // Positive control: a later request is logged, so a line of the rejected one would be there.
      const controlId = randomUUID();
      await request(server).get('/nope').set('X-Request-Id', controlId).expect(404);
      await logs.waitForAccessLine(controlId);
      expect(logs.text()).not.toContain(rejectedId);
      expect(logs.text()).not.toMatch(MARKERS);
    },
  );
});

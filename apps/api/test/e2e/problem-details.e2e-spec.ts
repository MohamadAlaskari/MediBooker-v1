import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { captureLogs } from '../support/log-capture.js';
import { UUID } from '../support/patterns.js';
import { ProbeModule } from '../support/probe.module.js';
import { ValidationProbeModule } from '../support/validation-probe.module.js';

const VALID_BODY = { email: 'sara@example.test', count: 1, items: [{ name: 'a' }] };

interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  requestId: string;
  params?: Record<string, unknown>;
  errors?: { field: string; code: string; message: string; params?: Record<string, unknown> }[];
}

function expectProblemHeaders(response: request.Response, status: number, code: string): Problem {
  const problem = JSON.parse(response.text) as Problem;
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toBe('application/problem+json; charset=utf-8');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['x-request-id']).toMatch(UUID);
  expect(problem).toMatchObject({ status, code, requestId: response.headers['x-request-id'] });
  expect(problem.type).toBe(`urn:medibooker:problem:${code.toLowerCase().replaceAll('_', '-')}`);
  return problem;
}

describe('every error is application/problem+json (05 §1)', () => {
  const logs = captureLogs();
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({
      imports: [ProbeModule, ValidationProbeModule],
      logDestination: logs,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (body: unknown): request.Test =>
    request(app.getHttpServer())
      .post('/api/v1/errors-probe/validate')
      .set('Content-Type', 'application/json')
      .send(body as object);

  it('answers NOT_FOUND for an unknown route, with the query in neither the body nor the logs', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/nope?email=sara@example.test');
    const problem = expectProblemHeaders(response, 404, 'NOT_FOUND');
    expect(problem.detail).toBe('Not found');
    expect(response.text).not.toContain('sara@example.test');
    await logs.waitForAccessLine(problem.requestId);
    expect(logs.text()).not.toContain('sara@example.test');
  });

  it('answers UNAUTHENTICATED for a route without @Public()', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/protected/1');
    expect(expectProblemHeaders(response, 401, 'UNAUTHENTICATED').detail).toBe(
      'Authentication required',
    );
  });

  it('accepts a valid body', async () => {
    const response = await post(VALID_BODY);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ accepted: true, items: 1 });
  });

  it('returns the paths of nested fields with field codes and no submitted value', async () => {
    const response = await post({
      email: 'not-an-email-secret-value',
      count: 11,
      items: [{ name: 'too-long-secret-value' }, { name: 3 }],
    });
    const problem = expectProblemHeaders(response, 400, 'VALIDATION_FAILED');
    expect(problem.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'email',
          code: 'INVALID_FORMAT',
          message: 'Invalid format',
          params: { format: 'email', hint: 'public' },
        }),
        expect.objectContaining({ field: 'count', code: 'TOO_LARGE' }),
        expect.objectContaining({ field: 'items[0].name', code: 'TOO_LONG' }),
        expect.objectContaining({ field: 'items[1].name', code: 'INVALID_TYPE' }),
      ]),
    );
    expect(response.text).not.toContain('secret-value');
  });

  it('reports an array that is too long and an item that is no object', async () => {
    const response = await post({ email: 'sara@example.test', count: 1, items: ['x', 'y', 'z'] });
    const problem = expectProblemHeaders(response, 400, 'VALIDATION_FAILED');
    expect(problem.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'items', code: 'TOO_LONG' }),
        expect.objectContaining({ field: 'items[0]', code: 'INVALID_TYPE' }),
      ]),
    );
  });

  it('lists at most 100 field errors, however many a body can name', async () => {
    const response = await post({ ...VALID_BODY, items: Array.from({ length: 500 }, () => ({})) });
    const problem = expectProblemHeaders(response, 400, 'VALIDATION_FAILED');
    expect(problem.errors).toHaveLength(100);
  });

  it('answers UNKNOWN_FIELD for an unknown property: a practice comes only from the path', async () => {
    const response = await post({ ...VALID_BODY, practiceId: 'secret-value', other: 1 });
    const problem = expectProblemHeaders(response, 400, 'VALIDATION_FAILED');
    expect(problem.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'practiceId', code: 'UNKNOWN_FIELD' }),
        expect.objectContaining({ field: 'other', code: 'UNKNOWN_FIELD' }),
      ]),
    );
    expect(response.text).not.toContain('secret-value');
  });

  it('answers VALIDATION_FAILED for malformed JSON, with the value in neither body nor logs', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/errors-probe/validate')
      .set('Content-Type', 'application/json')
      .send('{"email":"secret-value",');
    const problem = expectProblemHeaders(response, 400, 'VALIDATION_FAILED');
    expect(problem.detail).toBe('Validation failed');
    expect(response.text).not.toContain('secret-value');
    expect(logs.text()).not.toContain('secret-value');
  });

  it('answers PAYLOAD_TOO_LARGE for a body over 100 kB', async () => {
    const response = await post({ data: 'x'.repeat(100 * 1024) });
    expect(expectProblemHeaders(response, 413, 'PAYLOAD_TOO_LARGE').detail).toBe(
      'Payload too large',
    );
  });

  it('answers UNSUPPORTED_MEDIA_TYPE for a text/plain POST, and lets a POST without a body pass', async () => {
    const plain = await request(app.getHttpServer())
      .post('/api/v1/errors-probe/validate')
      .set('Content-Type', 'text/plain')
      .send('sara@example.test');
    expect(expectProblemHeaders(plain, 415, 'UNSUPPORTED_MEDIA_TYPE').detail).toBe(
      'Unsupported media type',
    );
    const empty = await request(app.getHttpServer()).post('/api/v1/errors-probe/validate');
    expect(expectProblemHeaders(empty, 400, 'VALIDATION_FAILED').errors).toBeDefined();
  });

  it('answers INTERNAL_ERROR for a thrown Error, without its stack, message or value', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/throws-error');
    const problem = expectProblemHeaders(response, 500, 'INTERNAL_ERROR');
    expect(Object.keys(problem).sort()).toEqual(
      ['code', 'detail', 'requestId', 'status', 'title', 'type'].sort(),
    );
    expect(response.text).not.toMatch(/secret-value|sara@example\.test|\bat /);
    await logs.waitForAccessLine(problem.requestId);
    expect(logs.text()).not.toMatch(/secret-value|sara@example\.test/);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ reqId: problem.requestId, msg: 'unknown exception' }),
    );
  });

  it('answers SERVICE_UNAVAILABLE with Retry-After for a PracticeUnavailableError, logged by its code', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/errors-probe/practice-unavailable',
    );
    const problem = expectProblemHeaders(response, 503, 'SERVICE_UNAVAILABLE');
    expect(response.headers['retry-after']).toBe('30');
    await logs.waitForAccessLine(problem.requestId);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({
        reqId: problem.requestId,
        msg: 'practice unavailable',
        reasonCode: 'PRACTICE_CONNECTION_FAILED',
      }),
    );
  });

  it('never copies the text of an HttpException', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/errors-probe/http-exception');
    expectProblemHeaders(response, 503, 'SERVICE_UNAVAILABLE');
    expect(response.text).not.toContain('secret-value');
  });

  it('answers with the detail and params of a DomainException, unlogged', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/errors-probe/domain');
    const problem = expectProblemHeaders(response, 409, 'CONFLICT');
    expect(problem.detail).toBe('The slot was booked by another request.');
    expect(problem.params).toEqual({ maxFutureAppointments: 2 });
    await logs.waitForAccessLine(problem.requestId);
    expect(
      logs.lines().filter((line) => line.reqId === problem.requestId && line.level === 'error'),
    ).toEqual([]);
  });

  it('logs a DomainException with a 5xx code', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/errors-probe/domain-internal');
    const problem = expectProblemHeaders(response, 500, 'INTERNAL_ERROR');
    await logs.waitForAccessLine(problem.requestId);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ reqId: problem.requestId, msg: 'unknown exception' }),
    );
    expect(logs.text()).not.toContain('secret-value');
  });

  it.each([
    ['prisma-conflict', 409, 'CONFLICT'],
    ['prisma-not-found', 404, 'NOT_FOUND'],
    ['prisma-other', 500, 'INTERNAL_ERROR'],
  ])('maps the untranslated Prisma error of %s', async (route, status, code) => {
    const response = await request(app.getHttpServer()).get(`/api/v1/errors-probe/${route}`);
    expectProblemHeaders(response, status, code);
    expect(response.text).not.toContain('secret-value');
  });

  it('answers every successful response with no-store', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/context').expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('the rate limit answers problem+json', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ env: { RATE_LIMIT_PER_MINUTE: '1' }, imports: [ProbeModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers RATE_LIMITED with Retry-After', async () => {
    await request(app.getHttpServer()).get('/api/v1/probe/context').expect(200);
    const response = await request(app.getHttpServer()).get('/api/v1/probe/context');
    expectProblemHeaders(response, 429, 'RATE_LIMITED');
    expect(response.headers['retry-after']).toBeDefined();
  });
});

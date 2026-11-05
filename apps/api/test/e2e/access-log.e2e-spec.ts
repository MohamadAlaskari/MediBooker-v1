import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { captureLogs } from '../support/log-capture.js';
import { UUID } from '../support/patterns.js';
import { ProbeModule } from '../support/probe.module.js';

/** Synthetic markers that must never reach a log line (02 §8). */
const NEVER_LOGGED = [
  'secret-value',
  'sara@example.test',
  'duplicate key',
  '/nope',
  'email',
  'Bearer',
  'sid=',
];

/** Every field of an access line, as pino, pino-http and the request logger write it. */
const ACCESS_LINE_FIELDS = [
  'hostname',
  'level',
  'msg',
  'pid',
  'req',
  'reqId',
  'res',
  'responseTime',
  'time',
];

describe('access log', () => {
  const logs = captureLogs();
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ imports: [ProbeModule], logDestination: logs });
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs GET /nope?email=… with credentials as id, method, null route and status only', async () => {
    const id = randomUUID();
    await request(app.getHttpServer())
      .get('/nope?email=sara@example.test')
      .set('X-Request-Id', id)
      .set('Authorization', 'Bearer secret-value')
      .set('Cookie', 'sid=secret-value')
      .expect(404);

    const line = await logs.waitForAccessLine(id);
    expect(line).toMatchObject({
      level: 30,
      reqId: id,
      req: { id, method: 'GET', route: null },
      res: { statusCode: 404 },
      responseTime: expect.any(Number) as unknown,
      msg: 'request completed',
    });
    // The field allowlist keeps every field of the access line and adds none (02 §8).
    expect(Object.keys(line).sort()).toEqual(ACCESS_LINE_FIELDS);
    expect(Object.keys(line.req as object).sort()).toEqual(['id', 'method', 'route']);
    expect(Object.keys(line.res as object)).toEqual(['statusCode']);
    expect(logs.lines().filter((logged) => logged.reqId === id)).toHaveLength(1);
    for (const marker of NEVER_LOGGED) expect(logs.text()).not.toContain(marker);
  });

  it('RT-05 logs the matched route pattern, never the concrete path', async () => {
    const id = randomUUID();
    await request(app.getHttpServer())
      .get('/api/v1/probe/protected/secret-value')
      .set('X-Request-Id', id)
      .expect(401);

    const line = await logs.waitForAccessLine(id);
    expect(line).toMatchObject({
      level: 30,
      req: { route: '/api/v1/probe/protected/:id' },
      res: { statusCode: 401 },
    });
    for (const marker of NEVER_LOGGED) expect(logs.text()).not.toContain(marker);
  });

  it('does not log the liveness probe; a later request to the same app is logged', async () => {
    const probeId = randomUUID();
    const controlId = randomUUID();
    await request(app.getHttpServer())
      .get('/health/live?probe=1')
      .set('X-Request-Id', probeId)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/probe/context')
      .set('X-Request-Id', controlId)
      .expect(200);

    // The control request finished after the probe, so a probe line would already be there.
    await logs.waitForAccessLine(controlId);
    expect(logs.text()).not.toContain(probeId);
  });

  it.each([
    ['an Error', '/api/v1/probe/throws-error', 'Error'],
    ['a thrown string', '/api/v1/probe/throws-string', 'string'],
  ])(
    'logs an unknown exception (%s) once at error, by its type and without its message',
    async (_case, path, type) => {
      const id = randomUUID();
      const response = await request(app.getHttpServer())
        .get(path)
        .set('X-Request-Id', id)
        .expect(500);
      expect(response.headers['x-request-id']).toMatch(UUID);
      expect(response.text).not.toMatch(/secret-value|sara@example\.test|duplicate key/);

      // 5xx at error (02 §8): the access line and the one exception line of this request.
      const accessLine = await logs.waitForAccessLine(id);
      expect(accessLine).toMatchObject({ level: 50, res: { statusCode: 500 } });
      expect(Object.keys(accessLine).sort()).toEqual([...ACCESS_LINE_FIELDS, 'err'].sort());
      const exceptionLines = logs
        .lines()
        .filter((line) => line.reqId === id && line.responseTime === undefined);
      expect(exceptionLines).toHaveLength(1);
      expect(exceptionLines[0]).toMatchObject({
        level: 50,
        context: 'UnknownExceptionFilter',
        msg: 'unknown exception',
        err: { type },
      });
      for (const marker of NEVER_LOGGED) expect(logs.text()).not.toContain(marker);
    },
  );

  it.each([
    [
      'a number as its message',
      '/api/v1/probe/throws-number-message',
      expect.objectContaining({
        type: 'Error',
        stack: expect.stringMatching(/^Error\n\s+at /) as unknown,
      }) as unknown,
    ],
    // The serializer fails on reading the message and falls back to the type.
    ['a message getter that throws', '/api/v1/probe/throws-failing-message', { type: 'Error' }],
    // Nest reads the message of an http-errors error to answer it; the filter answers 500 instead.
    [
      'the shape of an http-errors error and a message getter that throws',
      '/api/v1/probe/throws-exposed-failing-message',
      { type: 'Error' },
    ],
    // Nest reads err.constructor; the serializer reads the class from the prototype.
    [
      'a constructor getter that throws',
      '/api/v1/probe/throws-failing-constructor',
      expect.objectContaining({
        type: 'Error',
        stack: expect.stringMatching(/^Error\n\s+at /) as unknown,
      }) as unknown,
    ],
    // Express throws for a status outside 100 to 999; the filter answers anything but 4xx and 5xx
    // with 500, so the exception is not logged a second time.
    ...['99', '1000', '404.5'].map((status): [string, string, unknown] => [
      `the shape of an http-errors error and status ${status}`,
      `/api/v1/probe/throws-http-error-status/${status}`,
      expect.objectContaining({ type: 'Error' }) as unknown,
    ]),
    // instanceof throws on it, in the filter's checks as in the serializer's.
    [
      'a thrown value whose prototype cannot be read',
      '/api/v1/probe/throws-unreadable-value',
      {
        type: 'object',
      },
    ],
  ])(
    'logs an unknown exception with %s once, by its type, and answers 500',
    async (_case, path, expectedError: unknown) => {
      const id = randomUUID();
      await request(app.getHttpServer()).get(path).set('X-Request-Id', id).expect(500);

      await logs.waitForAccessLine(id);
      const exceptionLines = logs
        .lines()
        .filter((line) => line.reqId === id && line.responseTime === undefined);
      expect(exceptionLines).toEqual([
        expect.objectContaining({
          level: 50,
          context: 'UnknownExceptionFilter',
          msg: 'unknown exception',
          err: expectedError,
        }),
      ]);
      for (const marker of NEVER_LOGGED) expect(logs.text()).not.toContain(marker);
    },
  );

  it('answers an unknown http-errors error as Nest does, with its status, and logs it without its message', async () => {
    const id = randomUUID();
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/throws-http-error')
      .set('X-Request-Id', id)
      .expect(418);
    // `expose: false`: Nest answers with the status text instead of the message.
    expect(response.body).toEqual({ statusCode: 418, message: STATUS_CODES[418] });

    await logs.waitForAccessLine(id);
    const exceptionLines = logs
      .lines()
      .filter((line) => line.reqId === id && line.responseTime === undefined);
    expect(exceptionLines).toHaveLength(1);
    expect(exceptionLines[0]).toMatchObject({
      level: 50,
      context: 'UnknownExceptionFilter',
      msg: 'unknown exception',
      err: { type: 'Error' },
    });
    for (const marker of NEVER_LOGGED) expect(logs.text()).not.toContain(marker);
  });

  it('drops no field of a framework line: boot log, access lines and exception lines', async () => {
    const ids = [randomUUID(), randomUUID()];
    await request(app.getHttpServer()).get('/nope').set('X-Request-Id', ids[0]!).expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/probe/throws-error')
      .set('X-Request-Id', ids[1]!)
      .expect(500);
    for (const id of ids) await logs.waitForAccessLine(id);

    // Positive control: the capture holds a boot line and the exception line.
    expect(logs.text()).toContain('Mapped {/health/live, GET}');
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ reqId: ids[1], context: 'UnknownExceptionFilter' }),
    );
    expect(logs.lines().filter((line) => 'droppedFields' in line)).toEqual([]);
  });
});

describe('a second test app in the same file', () => {
  it('writes to its own destination, although nestjs-pino keeps one pino-http per file', async () => {
    const logs = captureLogs();
    const app = await createTestApp({ imports: [ProbeModule], logDestination: logs });
    try {
      const id = randomUUID();
      await request(app.getHttpServer()).get('/api/v1/probe/context').set('X-Request-Id', id);
      expect(await logs.waitForAccessLine(id)).toMatchObject({ req: { id } });
    } finally {
      await app.close();
    }
  });

  it('is refused when it asks for other log options, which the kept logger would ignore', async () => {
    const first = await createTestApp();
    try {
      await expect(createTestApp({ env: { LOG_LEVEL: 'debug' } })).rejects.toThrow(
        /needs a test file of its own/,
      );
    } finally {
      await first.close();
    }
  });
});

import { existsSync } from 'node:fs';
import { IncomingMessage, type ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import path from 'node:path';
import type { Logger } from 'pino';
import type { Options } from 'pino-http';
import { describe, expect, it } from 'vitest';
import { createCapturedLogger, type LogLine } from '../../../test/support/log-capture.js';
import { parseEnv } from '../../config/env.schema.js';
import { isHealthProbe, pinoOptions } from './pino-options.js';

const env = parseEnv({ APP_ENV: 'ci', LOG_LEVEL: 'debug' });
const prettyEnv = parseEnv({ APP_ENV: 'local', LOG_PRETTY: 'true' });

/** A message with the synthetic markers of 02 §8, as a database or library error can carry. */
const LEAKY_MESSAGE = 'duplicate key for sara@example.test (secret-value)';
const MARKERS = /secret-value|sara@example\.test|duplicate key|Sara|Bearer|sid=/;
const EMAIL = 'sara@example.test';
const SECRET_VALUE = 'secret-value';
const PRACTICE_ID = '00000000-0000-4000-8000-000000000001';

/** The fields that pino adds to every line of the root logger. */
const LINE_FIELDS = ['hostname', 'level', 'pid', 'time'];

function httpOptionsOf(params: ReturnType<typeof pinoOptions>): Options {
  const { pinoHttp: options } = params;
  if (Array.isArray(options)) return options[0];
  if (options === undefined || 'write' in options) throw new Error('pino-http options expected');
  return options;
}

function request(fields: Partial<IncomingMessage> & { originalUrl?: string }): IncomingMessage {
  return fields as IncomingMessage;
}

function fieldsOf(line: LogLine | undefined): string[] {
  return Object.keys(line ?? {}).sort();
}

/** The only line a logger wrote, after one call. */
function onlyLineOf(lines: LogLine[]): LogLine {
  expect(lines).toHaveLength(1);
  return lines[0]!;
}

class DatabaseError extends Error {
  readonly code = 'P2002';
  readonly detail = `Key (email)=(${EMAIL}) already exists.`;
}

describe('pinoOptions', () => {
  it('writes JSON to the given destination with the configured level', () => {
    const { logger, lines } = createCapturedLogger(env);
    logger.debug('a debug line');
    expect(lines()).toEqual([expect.objectContaining({ level: 20, msg: 'a debug line' })]);
    expect(httpOptionsOf(pinoOptions(env))).toMatchObject({
      level: 'debug',
      quietReqLogger: true,
      quietResLogger: true,
    });
  });

  it('writes to stdout without a destination and without pino-pretty by default', () => {
    const { pinoHttp: options } = pinoOptions(env);
    expect(Array.isArray(options)).toBe(false);
    expect(httpOptionsOf(pinoOptions(env)).transport).toBeUndefined();
  });

  it('LOG_PRETTY uses pino-pretty, resolved by absolute path from the API', () => {
    const transport = httpOptionsOf(pinoOptions(prettyEnv)).transport as { target: string };
    expect(path.isAbsolute(transport.target)).toBe(true);
    expect(transport.target).toMatch(/pino-pretty/);
    expect(existsSync(transport.target)).toBe(true);
  });

  it('keeps the field allowlist, the serializers, the redaction and the message hook with LOG_PRETTY', () => {
    const plain = httpOptionsOf(pinoOptions(env));
    const pretty = httpOptionsOf(pinoOptions(prettyEnv));
    expect(plain.formatters?.log).toBeTypeOf('function');
    expect(plain.hooks?.logMethod).toBeTypeOf('function');
    expect(pretty.formatters?.log).toBe(plain.formatters?.log);
    expect(pretty.hooks?.logMethod).toBe(plain.hooks?.logMethod);
    expect(pretty.serializers).toEqual(plain.serializers);
    expect(pretty.wrapSerializers).toBe(false);
    expect(pretty.redact).toEqual(plain.redact);
  });

  it('logs 5xx and errors at error, everything else at info', () => {
    const level = httpOptionsOf(pinoOptions(env)).customLogLevel;
    const req = request({});
    expect(level?.(req, { statusCode: 500 } as ServerResponse)).toBe('error');
    expect(level?.(req, { statusCode: 200 } as ServerResponse, new Error('x'))).toBe('error');
    expect(level?.(req, { statusCode: 404 } as ServerResponse)).toBe('info');
  });

  it('adds the request at completion, for the route pattern', () => {
    const options = httpOptionsOf(pinoOptions(env));
    const req = request({ method: 'GET' });
    const res = {} as ServerResponse;
    expect(options.customSuccessObject?.(req, res, { responseTime: 1 })).toEqual({
      responseTime: 1,
      req,
    });
    const error = new Error('x');
    expect(options.customErrorObject?.(req, res, error, { err: error })).toEqual({
      err: error,
      req,
    });
  });

  it('hands the raw error to the error serializer: pino-std-serializers never read it', () => {
    // pino-http would wrap the serializers with pino-std-serializers' ones, which read the message
    // (and every other property) before the allowlist serializer runs.
    expect(httpOptionsOf(pinoOptions(env)).wrapSerializers).toBe(false);
    const error = new Error(LEAKY_MESSAGE);
    Object.defineProperty(error, 'message', {
      get: (): never => {
        throw new RangeError(SECRET_VALUE);
      },
    });
    const { logger, lines } = createCapturedLogger(env);
    logger.error({ err: error }, 'unknown exception');
    expect(onlyLineOf(lines())).toMatchObject({ msg: 'unknown exception', err: { type: 'Error' } });
  });
});

describe('the field allowlist (formatters.log)', () => {
  it('drops fields that no allowlist names and counts them, without their names', () => {
    const { logger, lines, text } = createCapturedLogger(env);
    logger.info(
      {
        address: `1 ${SECRET_VALUE} street`,
        name: `Sara ${SECRET_VALUE}`,
        mfaSecret: SECRET_VALUE,
        accessToken: SECRET_VALUE,
      },
      'fields',
    );
    const line = onlyLineOf(lines());
    expect(line).toMatchObject({ msg: 'fields', droppedFields: 4 });
    expect(fieldsOf(line)).toEqual([...LINE_FIELDS, 'droppedFields', 'msg'].sort());
    expect(text()).not.toMatch(/secret-value|address|mfaSecret|accessToken|"name"/);
  });

  it('drops an object with personal data three levels down', () => {
    const { logger, lines, text } = createCapturedLogger(env);
    logger.warn({ appointment: { patient: { contact: { email: EMAIL } } } });
    expect(fieldsOf(onlyLineOf(lines()))).toEqual([...LINE_FIELDS, 'droppedFields'].sort());
    expect(text()).not.toMatch(/sara@example\.test|appointment/);
  });

  it('drops an error under another key than err, which the error serializer would not see', () => {
    const { logger, lines, text } = createCapturedLogger(env);
    logger.error({ error: new DatabaseError(LEAKY_MESSAGE) }, 'db failed');
    expect(onlyLineOf(lines())).toMatchObject({ msg: 'db failed', droppedFields: 1 });
    expect(text()).not.toMatch(MARKERS);
  });

  it('drops a msg field: the message is only ever the message argument', () => {
    const { logger, lines, text } = createCapturedLogger(env);
    logger.info({ msg: `booked for ${EMAIL}` });
    expect(fieldsOf(onlyLineOf(lines()))).toEqual([...LINE_FIELDS, 'droppedFields'].sort());
    expect(text()).not.toMatch(MARKERS);
  });

  it.each(['UnknownExceptionFilter', 'RouterExplorer', 'NestFactory', 'LogProbe'])(
    'keeps the class name %s as the context',
    (context) => {
      const { logger, lines } = createCapturedLogger(env);
      logger.info({ context }, 'message');
      expect(fieldsOf(onlyLineOf(lines()))).toEqual([...LINE_FIELDS, 'context', 'msg'].sort());
    },
  );

  it.each<[string, unknown]>([
    ['an e-mail address', EMAIL],
    ['a stack', new Error(LEAKY_MESSAGE).stack],
    ['a sentence', `Sara ${SECRET_VALUE}`],
    ['an empty string', ''],
    ['an object', { email: EMAIL }],
    ['a number', 42],
  ])('drops %s as the context, which a Nest Logger without one passes', (_case, context) => {
    const { logger, lines, text } = createCapturedLogger(env);
    logger.info({ context }, 'message');
    expect(onlyLineOf(lines())).toMatchObject({ msg: 'message', droppedFields: 1 });
    expect(onlyLineOf(lines())).not.toHaveProperty('context');
    expect(text()).not.toMatch(MARKERS);
  });

  it('keeps the reviewed fields practiceId and clusterId with a primitive value', () => {
    const { logger, lines } = createCapturedLogger(env);
    logger.info({ practiceId: PRACTICE_ID, clusterId: 'local' }, 'practice client created');
    const line = onlyLineOf(lines());
    expect(line).toMatchObject({ practiceId: PRACTICE_ID, clusterId: 'local' });
    expect(line).not.toHaveProperty('droppedFields');
  });

  it('drops a reviewed field whose value is not a primitive', () => {
    const { logger, lines, text } = createCapturedLogger(env);
    logger.info({ practiceId: { email: EMAIL }, clusterId: [SECRET_VALUE] }, 'message');
    expect(onlyLineOf(lines())).toMatchObject({ droppedFields: 2 });
    expect(text()).not.toMatch(MARKERS);
  });

  it('keeps responseTime as a number only', () => {
    const { logger, lines } = createCapturedLogger(env);
    logger.info({ responseTime: 3 }, 'timed');
    logger.info({ responseTime: EMAIL }, 'timed');
    expect(lines()).toEqual([
      expect.objectContaining({ responseTime: 3 }),
      expect.objectContaining({ droppedFields: 1 }),
    ]);
    expect(lines()[1]).not.toHaveProperty('responseTime');
  });

  it('counts a field named droppedFields like any other unreviewed field', () => {
    const { logger, lines } = createCapturedLogger(env);
    logger.info({ droppedFields: SECRET_VALUE, other: SECRET_VALUE }, 'message');
    expect(onlyLineOf(lines())).toMatchObject({ droppedFields: 2 });
  });

  it('adds no droppedFields when nothing was dropped, and skips undefined values like pino', () => {
    const { logger, lines } = createCapturedLogger(env);
    logger.info({ practiceId: PRACTICE_ID, other: undefined }, 'message');
    expect(fieldsOf(onlyLineOf(lines()))).toEqual([...LINE_FIELDS, 'msg', 'practiceId'].sort());
  });
});

describe('the order of a log line: allowlist, then serializers, then redaction', () => {
  it('passes err to the error serializer after the allowlist', () => {
    const { logger, lines, text } = createCapturedLogger(env);
    logger.error({ err: new DatabaseError(LEAKY_MESSAGE) }, 'db failed');
    const line = onlyLineOf(lines());
    expect(fieldsOf(line)).toEqual([...LINE_FIELDS, 'err', 'msg'].sort());
    expect(Object.keys(line.err as object).sort()).toEqual(['code', 'stack', 'type']);
    expect(line.err).toMatchObject({ type: 'DatabaseError', code: 'P2002' });
    expect(text()).not.toMatch(MARKERS);
  });

  it('passes req and res to their serializers after the allowlist', () => {
    const { logger, lines, text } = createCapturedLogger(env);
    // The raw Node request, as pino-http passes it: the serializer reads the route only from one.
    const req = Object.assign(new IncomingMessage(new Socket()), {
      id: '0b5c1f3e-9a2d-4c6b-8e7f-1a2b3c4d5e6f',
      method: 'GET',
      url: `/api/v1/probe/protected/${SECRET_VALUE}?email=${EMAIL}`,
      headers: { authorization: `Bearer ${SECRET_VALUE}`, cookie: `sid=${SECRET_VALUE}` },
      route: { path: '/api/v1/probe/protected/:id' },
    });
    logger.info({ req, res: { statusCode: 401 }, responseTime: 2 }, 'request completed');
    expect(onlyLineOf(lines())).toMatchObject({
      req: { id: req.id, method: 'GET', route: '/api/v1/probe/protected/:id' },
      res: { statusCode: 401 },
      responseTime: 2,
    });
    expect(text()).not.toMatch(MARKERS);
  });

  it('redacts child-logger bindings, which the allowlist does not see', () => {
    const { logger, lines, text } = createCapturedLogger(env);
    logger
      .child({ email: EMAIL, patient: { firstName: SECRET_VALUE } })
      .info({ practiceId: PRACTICE_ID });
    expect(onlyLineOf(lines())).toMatchObject({
      email: '[Redacted]',
      patient: { firstName: '[Redacted]' },
      practiceId: PRACTICE_ID,
    });
    expect(text()).not.toMatch(MARKERS);
  });
});

describe('messages (hooks.logMethod)', () => {
  it.each<[string, (logger: Logger) => void, string]>([
    [
      'logger.info(template, value)',
      (logger) => {
        logger.info('booked for %s', EMAIL);
      },
      'booked for %s',
    ],
    [
      'logger.info(fields, template, value)',
      (logger) => {
        logger.info({ practiceId: PRACTICE_ID }, 'booked for %s', EMAIL);
      },
      'booked for %s',
    ],
    [
      'logger.info(template with %j, object)',
      (logger) => {
        logger.info('patient %j', { email: EMAIL });
      },
      'patient %j',
    ],
    [
      'logger.info(template with %o, object)',
      (logger) => {
        logger.info('patient %o', { email: EMAIL });
      },
      'patient %o',
    ],
    [
      'logger.info(null, template, value)',
      (logger) => {
        logger.info(null, 'booked for %s', EMAIL);
      },
      'booked for %s',
    ],
    [
      'logger.info(undefined, template, value)',
      (logger) => {
        logger.info(undefined, 'booked for %s', EMAIL);
      },
      'booked for %s',
    ],
    [
      'logger.info(message, value, value) without a placeholder',
      (logger) => {
        // pino's types reject extra values without a placeholder; JavaScript callers can pass them.
        Reflect.apply(logger.info, logger, ['booked', EMAIL, SECRET_VALUE]);
      },
      'booked',
    ],
  ])('%s logs the template only, never the values', (_case, log, msg) => {
    const { logger, lines, text } = createCapturedLogger(env);
    log(logger);
    expect(onlyLineOf(lines())).toMatchObject({ msg });
    expect(text()).not.toMatch(MARKERS);
  });

  it('keeps the context of a call as nestjs-pino forwards it from a Nest Logger with one', () => {
    const { logger, lines, text } = createCapturedLogger(env);
    logger.info({ context: 'LogProbe' }, 'booked for %s', EMAIL);
    expect(onlyLineOf(lines())).toMatchObject({ context: 'LogProbe', msg: 'booked for %s' });
    expect(text()).not.toMatch(MARKERS);
  });

  it.each<[string, (logger: Logger) => void, string]>([
    [
      'an object',
      (logger) => {
        logger.info({ practiceId: PRACTICE_ID }, { email: EMAIL } as unknown as string);
      },
      'object',
    ],
    [
      'an error',
      (logger) => {
        logger.error(
          { practiceId: PRACTICE_ID },
          new TypeError(LEAKY_MESSAGE) as unknown as string,
        );
      },
      'TypeError',
    ],
    [
      'a number as the first argument',
      (logger) => {
        logger.info(42);
      },
      'number',
    ],
  ])('replaces a message that is %s with its type', (_case, log, msg) => {
    const { logger, lines, text } = createCapturedLogger(env);
    log(logger);
    expect(onlyLineOf(lines())).toMatchObject({ msg });
    expect(text()).not.toMatch(MARKERS);
  });

  it('logs a line without a message as pino does', () => {
    const { logger, lines } = createCapturedLogger(env);
    logger.info({ practiceId: PRACTICE_ID });
    expect(onlyLineOf(lines())).not.toHaveProperty('msg');
  });
});

describe('an error logged without a message of its own', () => {
  // pino would copy the error's message into `msg` (02 §8); nestjs-pino forwards Nest's
  // `logger.error(exception)` as `{ context, err }` with an undefined message.
  it.each<[string, (logger: Logger, error: Error) => void]>([
    [
      'logger.error(err)',
      (logger, error) => {
        logger.error(error);
      },
    ],
    [
      'logger.error({ err })',
      (logger, error) => {
        logger.error({ err: error });
      },
    ],
    [
      'logger.error({ context, err }, undefined) from nestjs-pino',
      (logger, error) => {
        logger.error({ context: 'ExceptionsHandler', err: error }, undefined);
      },
    ],
    [
      'a request logger (child)',
      (logger, error) => {
        logger.child({ reqId: 'r-1' }).error(error);
      },
    ],
  ])('%s gets the error type as its message, never the message', (_case, log) => {
    const { logger, lines } = createCapturedLogger(env);
    log(logger, new TypeError(LEAKY_MESSAGE));
    expect(lines()).toEqual([
      expect.objectContaining({ level: 50, msg: 'TypeError', err: expect.anything() as unknown }),
    ]);
    expect(JSON.stringify(lines())).not.toMatch(MARKERS);
  });

  it('keeps a message that the call passes itself', () => {
    const { logger, lines } = createCapturedLogger(env);
    logger.error({ err: new Error(LEAKY_MESSAGE) }, 'unknown exception');
    expect(lines()).toMatchObject([{ msg: 'unknown exception', err: { type: 'Error' } }]);
    expect(JSON.stringify(lines())).not.toMatch(MARKERS);
  });

  it('copies no message when the call passes a msg field, which the allowlist then drops', () => {
    const { logger, lines } = createCapturedLogger(env);
    logger.error({ err: new Error(LEAKY_MESSAGE), msg: 'own msg field' });
    const line = onlyLineOf(lines());
    expect(line).toMatchObject({ err: { type: 'Error' }, droppedFields: 1 });
    expect(line).not.toHaveProperty('msg');
    expect(JSON.stringify(lines())).not.toMatch(MARKERS);
  });

  it('leaves calls without an error unchanged', () => {
    const { logger, lines } = createCapturedLogger(env);
    logger.info({ practiceId: PRACTICE_ID });
    logger.info('plain message');
    expect(lines().map((line) => line.msg)).toEqual([undefined, 'plain message']);
  });

  it('names a value that is not an Error by its type', () => {
    const { logger, lines } = createCapturedLogger(env);
    logger.error({ err: { message: LEAKY_MESSAGE } });
    expect(lines()[0]).toMatchObject({ msg: 'object', err: { type: 'object' } });
    expect(JSON.stringify(lines())).not.toMatch(MARKERS);
  });
});

describe('REDACTED_PATHS, the second line', () => {
  // The allowlist removes these fields from the object of a log call before redaction runs, so
  // redaction is proven where the allowlist does not apply: child-logger bindings (`logger.child`,
  // nestjs-pino's `PinoLogger.assign`).
  it.each([
    'password',
    'token',
    'refreshToken',
    'email',
    'phone',
    'firstName',
    'lastName',
    'dateOfBirth',
    'insuranceNumber',
    'patientNote',
    'accessToken',
    'mfaSecret',
    'secret',
    'passwordHash',
    'recoveryCodes',
    'deviceToken',
  ])('redacts %s at the top level and one and two levels down', (field) => {
    const { logger, text } = createCapturedLogger(env);
    logger
      .child({
        [field]: SECRET_VALUE,
        one: { [field]: SECRET_VALUE },
        two: { levels: { [field]: SECRET_VALUE } },
        list: [{ [field]: SECRET_VALUE }],
      })
      .info('bound');
    expect(text()).not.toContain(SECRET_VALUE);
    expect(text().match(/\[Redacted\]/g)).toHaveLength(4);
  });
});

describe('isHealthProbe', () => {
  it.each(['/health/live', '/health/live?probe=1'])('matches %s', (url) => {
    expect(isHealthProbe(request({ url }))).toBe(true);
  });

  it.each(['/health/livex', '/api/v1/health/live', '/health', '/'])('does not match %s', (url) => {
    expect(isHealthProbe(request({ url }))).toBe(false);
  });

  it('reads the original URL when Express rewrote url for a mounted middleware', () => {
    expect(isHealthProbe(request({ url: '/', originalUrl: '/health/live' }))).toBe(true);
  });

  it('does not match a request without a URL', () => {
    expect(isHealthProbe(request({}))).toBe(false);
  });
});

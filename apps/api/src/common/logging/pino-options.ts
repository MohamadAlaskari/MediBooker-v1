import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { Params } from 'nestjs-pino';
import type { DestinationStream, LogFn, Logger } from 'pino';
import type { Options } from 'pino-http';
import type { Env } from '../../config/env.schema.js';
import { requestIdOf } from '../context/request-id.js';
import { onlyAllowedFields } from './log-fields.js';
import { REDACTED_PATHS } from './redaction.js';
import {
  errorTypeOf,
  isError,
  serializeError,
  serializeRequest,
  serializeResponse,
} from './serializers.js';

/** Exact paths of the health probes, which are never logged (02 §8). F04 adds `/health/ready`. */
const UNLOGGED_PATHS: ReadonlySet<string> = new Set(['/health/live']);

/** True for a health probe, compared without the query string. */
export function isHealthProbe(req: IncomingMessage): boolean {
  const url =
    'originalUrl' in req && typeof req.originalUrl === 'string' ? req.originalUrl : req.url;
  return url !== undefined && UNLOGGED_PATHS.has(url.split('?', 1)[0] ?? '');
}

/** The error in a log call's first argument as pino reads it: `err`, or `{ err }` without `msg`. */
function errorCarriedBy(first: unknown): unknown {
  if (isError(first)) return first;
  if (typeof first !== 'object' || first === null || !('err' in first)) return undefined;
  if ('msg' in first && first.msg !== undefined) return undefined;
  return first.err;
}

/** A message as written in code; anything else is replaced by its type. */
function constantMessageOf(message: unknown): string {
  return typeof message === 'string' ? message : errorTypeOf(message);
}

/**
 * pino's `logMethod` hook (02 §8), part of `pinoOptions` and so of every child logger. It passes on
 * the first argument and the message only, so a line's message is the message argument as the
 * call wrote it, never an interpolation value or an error's message that pino copies; the F02
 * ESLint rule makes that argument a literal in project code (02 §8):
 * - Interpolation values are dropped: `logger.info('booked for %s', email)` logs `booked for %s`,
 *   also when nestjs-pino forwards a Nest `Logger.log` call as `({ context }, message, ...values)`.
 * - A message that is not a string becomes its type: pino would write an object as JSON.
 * - A call that passes an error without a message of its own gets the error's type as its message:
 *   pino 10.4 (`write`) would copy the error's message into `msg`. That covers `logger.error(err)`,
 *   `logger.error({ err })` and Nest's `logger.error(exception)`, which nestjs-pino forwards as
 *   `({ context, err }, undefined)`.
 */
export function keepMessageConstant(this: Logger, args: Parameters<LogFn>, method: LogFn): void {
  const values: readonly unknown[] = args;
  const [first, second] = values;
  if (first !== undefined && typeof first !== 'object') {
    // `logger.info(message, ...values)`: the first argument is the message.
    method.call(this, constantMessageOf(first));
    return;
  }
  // `logger.info(fields, message, ...values)`; the fields may also be an Error, null or undefined.
  const error = errorCarriedBy(first);
  let message: string | undefined;
  if (second !== undefined) message = constantMessageOf(second);
  else if (error !== undefined) message = errorTypeOf(error);
  if (message === undefined) method.call(this, first);
  else method.call(this, first, message);
}

/**
 * pino-pretty is a devDependency, used only with LOG_PRETTY (rejected with NODE_ENV=production).
 * With pnpm's isolated layout pino cannot resolve it by name, so the target is an absolute path.
 */
function prettyTransport(): NonNullable<Options['transport']> {
  return {
    target: createRequire(import.meta.url).resolve('pino-pretty'),
    options: { ignore: 'pid,hostname', translateTime: 'UTC:yyyy-mm-dd HH:MM:ss.l' },
  };
}

/**
 * The access log and the application logger (02 §8). Every log call passes the message hook, then
 * the field allowlist (`formatters.log`), then the allowlist serializers, then the redaction.
 * pino-http hands the serializers the raw request, response and error (`wrapSerializers: false`):
 * its default wrappers from pino-std-serializers would read every property first, the message
 * included, and a getter that throws there would fail the log call.
 *
 * pino-http binds a child logger's fields when the request starts, before routing, so `req` is
 * added at completion instead (`quietReqLogger`, `quietResLogger` and the custom objects): only
 * then does `req.route` hold the matched pattern, also for a request that a guard rejected. Lines
 * logged during a request carry `reqId`. `destination` is for tests; without it pino writes to
 * stdout. With LOG_PRETTY the pino-pretty transport writes to stdout and `destination` is not used.
 */
export function pinoOptions(env: Env, destination?: DestinationStream): Params {
  const options: Options = {
    level: env.LOG_LEVEL,
    genReqId: (req) => requestIdOf(req),
    quietReqLogger: true,
    quietResLogger: true,
    autoLogging: { ignore: isHealthProbe },
    wrapSerializers: false,
    serializers: { req: serializeRequest, res: serializeResponse, err: serializeError },
    customSuccessObject: (req: IncomingMessage, _res: ServerResponse, value: object) => ({
      ...value,
      req,
    }),
    customErrorObject: (req: IncomingMessage, _res: ServerResponse, _error, value: object) => ({
      ...value,
      req,
    }),
    customLogLevel: (_req, res, error) =>
      error !== undefined || res.statusCode >= 500 ? 'error' : 'info',
    formatters: { log: onlyAllowedFields },
    redact: [...REDACTED_PATHS],
    hooks: { logMethod: keepMessageConstant },
  };
  if (env.LOG_PRETTY) return { pinoHttp: { ...options, transport: prettyTransport() } };
  return { pinoHttp: destination === undefined ? options : [options, destination] };
}

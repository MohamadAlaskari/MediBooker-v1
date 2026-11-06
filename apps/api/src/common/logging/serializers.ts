import { IncomingMessage, METHODS } from 'node:http';
import { isUuid } from '../context/request-id.js';
import { driverFailureOf, isPrismaKnownRequestError } from '../database/prisma-errors.js';

/**
 * Allowlist serializers for the access log and every other log line (02 §8). pino-http hands them
 * the raw request, response and error (`wrapSerializers: false` in pinoOptions), and they read only
 * the properties named here, each in a form that cannot carry other text: never the URL, the query
 * string, headers, bodies or error messages. Messages also stay out of `msg`: the
 * `keepMessageConstant` hook (pino-options.ts) and the ProblemDetailsFilter keep pino from
 * copying them there.
 */

export interface LoggedRequest {
  id: string | null;
  method: string | null;
  route: string | null;
}

export interface LoggedResponse {
  statusCode: number | null;
}

export interface LoggedError {
  type: string;
  code?: string;
  prismaCode?: string;
  model?: string;
  constraint?: string;
  stack?: string;
}

/** The methods Node's HTTP parser accepts; a request can have no other. */
const HTTP_METHODS: ReadonlySet<string> = new Set(METHODS);

/** A class name as JavaScript writes it, which can be no other text. */
const CLASS_NAME = /^[A-Za-z_$][\w$]{0,63}$/;

/** An error code such as `ERR_INVALID_ARG_TYPE`, `ECONNREFUSED`, `P2002` or `23505`. */
const ERROR_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** A Prisma error code such as `P2002`. */
const PRISMA_CODE = /^P\d{4}$/;

/** A SQLSTATE such as `23505`. */
const SQL_STATE = /^[0-9A-Z]{5}$/;

/** A Prisma model name such as `PracticeSlug`. */
const MODEL_NAME = /^[A-Z][A-Za-z0-9_]{0,63}$/;

/** A PostgreSQL identifier such as `practice_slugs_pkey`. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;

/**
 * A stack frame as V8 writes it, ending in its location: `(file:line:column)`, `file:line:column`,
 * a WebAssembly location (`wasm://wasm/…:wasm-function[n]:0x…`), `(native)`, `(<anonymous>)` or
 * `(index n)`, or the bare `at <anonymous>`. A line of an error's message cannot pass for one
 * unless it ends like a location.
 */
const STACK_FRAME =
  /^\s+at (?:<anonymous>|.+(?::\d+:\d+|:wasm-function\[\d+\]:0x[0-9a-f]+)\)?|.+\((?:native|<anonymous>|index \d+)\))$/;

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** `instanceof Error`, false also for a value whose prototype cannot be read (a Proxy that throws). */
export function isError(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

/**
 * The matched route pattern (`/api/v1/practices/:practiceId/…`), never the concrete path. Read at
 * completion, when Express has set `req.route`; an unmatched request ends on a middleware mount
 * pattern, which always contains `*`, and is logged as null.
 */
function routePatternOf(req: IncomingMessage): string | null {
  if (!('route' in req) || !isObject(req.route) || !('path' in req.route)) return null;
  const pattern = req.route.path;
  return typeof pattern === 'string' && !pattern.includes('*') ? pattern : null;
}

/**
 * `{ id, method, route }`, each only in its own form: the id as a UUID, the method as one of Node's
 * HTTP methods, and the route only from a Node request. A hand-written `{ req: someObject }`
 * therefore logs nulls, never the object's fields.
 */
export function serializeRequest(req: unknown): LoggedRequest {
  if (!isObject(req)) return { id: null, method: null, route: null };
  const id: unknown = 'id' in req ? req.id : undefined;
  const method: unknown = 'method' in req ? req.method : undefined;
  return {
    id: isUuid(id) ? id : null,
    method: typeof method === 'string' && HTTP_METHODS.has(method) ? method : null,
    route: req instanceof IncomingMessage ? routePatternOf(req) : null,
  };
}

export function serializeResponse(res: unknown): LoggedResponse {
  if (!isObject(res) || !('statusCode' in res)) return { statusCode: null };
  return { statusCode: typeof res.statusCode === 'number' ? res.statusCode : null };
}

/** The name of the error's class, read from its prototype: an own `constructor` property is ignored. */
function classNameOf(error: Error): unknown {
  const prototype: unknown = Object.getPrototypeOf(error);
  if (!isObject(prototype) || !('constructor' in prototype)) return undefined;
  const { constructor } = prototype;
  return typeof constructor === 'function' ? constructor.name : undefined;
}

/**
 * The class name of an error, or the type of a thrown value that is not an error. A class name
 * that cannot be read, or that is not written like one, gives `Error`.
 */
export function errorTypeOf(value: unknown): string {
  if (!isError(value)) return typeof value;
  try {
    const name = classNameOf(value);
    return typeof name === 'string' && CLASS_NAME.test(name) ? name : 'Error';
  } catch {
    return 'Error';
  }
}

/**
 * The headers a stack can start with, from the error as it is now. Node writes the header when
 * `stack` is first read: `Error.prototype.toString` of the error (`Name: message`, `Name` or
 * `message`), and for most of its own errors `Name [CODE]: message`.
 */
function stackHeadersOf(error: Error): string[] {
  const headers = [Error.prototype.toString.call(error)];
  const code: unknown = 'code' in error ? error.code : undefined;
  if (typeof code === 'string') {
    const name = `${error.name} [${code}]`;
    headers.push(Error.prototype.toString.call({ name, message: error.message }));
  }
  return headers;
}

/**
 * The stack frames without the header. The header spans as many lines as the name and the message
 * have, and a line of them can look like a frame (`    at …`), so it is cut off whole, in one of
 * the forms of `stackHeadersOf`. A stack that starts with neither (the message changed after the
 * stack was written, or the stack is another error's) gets no frames: its header has an unknown
 * length. Of the rest only lines in the form of a frame are kept.
 */
function stackFramesOf(error: Error): string[] {
  const stack: unknown = error.stack;
  if (typeof stack !== 'string') return [];
  const header = stackHeadersOf(error).find(
    (form) => stack === form || stack.startsWith(`${form}\n`),
  );
  if (header === undefined || stack === header) return [];
  return stack
    .slice(header.length + 1)
    .split('\n')
    .filter((line) => STACK_FRAME.test(line));
}

function isInForm(value: unknown, form: RegExp): value is string {
  return typeof value === 'string' && form.test(value);
}

type LoggedCodes = Pick<LoggedError, 'code' | 'prismaCode' | 'model' | 'constraint'>;

/**
 * The codes of an error, each only in its form. A Prisma error (F04) gives its `prismaCode`, the
 * database's SQLSTATE as `code`, its `model` and the `constraint` of a unique violation, read from
 * the driver adapter's report; never its message, a meta value or its cause, which can carry the
 * values of a row. Any other error gives its `code`.
 */
function codesOf(error: Error): LoggedCodes {
  if (!isPrismaKnownRequestError(error)) {
    const code: unknown = 'code' in error ? error.code : undefined;
    return isInForm(code, ERROR_CODE) ? { code } : {};
  }
  const failure = driverFailureOf(error);
  const prismaCode = error.code;
  const sqlState = failure?.sqlState;
  const model: unknown = error.meta?.modelName;
  const constraint = failure?.index;
  return {
    ...(isInForm(sqlState, SQL_STATE) ? { code: sqlState } : {}),
    ...(isInForm(prismaCode, PRISMA_CODE) ? { prismaCode } : {}),
    ...(isInForm(model, MODEL_NAME) ? { model } : {}),
    ...(isInForm(constraint, IDENTIFIER) ? { constraint } : {}),
  };
}

/**
 * `{ type, code, prismaCode, model, constraint, stack }`, each code only in its form, and the
 * stack with its header replaced by the class name. When reading the error fails in any way (a
 * getter that throws), only the type is logged, so the log call itself never fails. X01 adds
 * `message` for the project's own `DomainException`.
 */
export function serializeError(value: unknown): LoggedError {
  const type = errorTypeOf(value);
  if (!isError(value)) return { type };
  try {
    return { type, ...codesOf(value), stack: [type, ...stackFramesOf(value)].join('\n') };
  } catch {
    return { type };
  }
}

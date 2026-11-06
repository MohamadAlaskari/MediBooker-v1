import type { ServerResponse } from 'node:http';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { PinoLogger } from 'nestjs-pino';
import { REQUEST_ID_HEADER } from '../context/request-id.js';
import {
  PRACTICE_RETRY_AFTER_SECONDS,
  PracticeUnavailableError,
} from '../tenancy/practice-errors.js';
import { DomainException } from './domain.exception.js';
import {
  ERROR_CATALOG,
  type ErrorCode,
  errorCodeOfStatus,
  problemTypeOf,
} from './error-catalog.js';
import type { FieldError } from './field-error-codes.js';

/** What an exception becomes; every text of the response comes from here or the catalogue. */
interface Problem {
  readonly code: ErrorCode;
  readonly detail?: string | undefined;
  readonly params?: Readonly<Record<string, unknown>> | undefined;
  readonly errors?: readonly FieldError[] | undefined;
}

/** Prisma errors that a service did not translate (05 §1.3). */
const PRISMA_CODES: Readonly<Record<string, ErrorCode>> = {
  P2002: 'CONFLICT',
  P2003: 'CONFLICT',
  P2034: 'CONFLICT',
  P2025: 'NOT_FOUND',
};

/** `instanceof`, false also for a value whose prototype cannot be read (a Proxy). */
function isInstance<T>(value: unknown, type: abstract new (...args: never[]) => T): value is T {
  try {
    return value instanceof type;
  } catch {
    return false;
  }
}

/**
 * The status of an error that carries one, such as the body parser's: a whole number from 400 to
 * 599. A property that throws when it is read counts as none, so answering never fails.
 */
function statusOf(exception: unknown): number | undefined {
  try {
    if (exception instanceof HttpException) return exception.getStatus();
    if (typeof exception !== 'object' || exception === null) return undefined;
    const status: unknown = Reflect.get(exception, 'status');
    return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
      ? status
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Only the code and the status decide the answer: Nest puts an excerpt of a malformed body and the
 * full URL with its query string into `message` and `getResponse()`, so neither is ever read.
 */
function problemOf(exception: unknown): Problem {
  if (isInstance(exception, DomainException)) {
    return {
      code: exception.code,
      detail: exception.detail,
      params: exception.params,
      errors: exception.fieldErrors,
    };
  }
  if (isInstance(exception, PracticeUnavailableError)) return { code: 'SERVICE_UNAVAILABLE' };
  if (isInstance(exception, PrismaClientKnownRequestError)) {
    return { code: PRISMA_CODES[exception.code] ?? 'INTERNAL_ERROR' };
  }
  const status = statusOf(exception);
  return { code: status === undefined ? 'INTERNAL_ERROR' : errorCodeOfStatus(status) };
}

/**
 * The global filter: every error answers as `application/problem+json` with `no-store` (05 §1.3).
 * An exception that no code path expected is logged once, at error, with a constant message and
 * `err` from the error serializer (02 §8): a thrown string would become the message, and the
 * fields of a thrown object would land in the line, and any of them can carry personal data.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    logger.setContext(ProblemDetailsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ServerResponse>();
    const problem = problemOf(exception);
    const { status, title } = ERROR_CATALOG[problem.code];
    this.log(exception, status);
    if (response.headersSent) {
      response.end();
      return;
    }
    if (isInstance(exception, PracticeUnavailableError)) {
      response.setHeader('Retry-After', String(PRACTICE_RETRY_AFTER_SECONDS));
    }
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/problem+json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(
      JSON.stringify({
        type: problemTypeOf(problem.code),
        title,
        status,
        detail: problem.detail ?? title,
        code: problem.code,
        requestId: response.getHeader(REQUEST_ID_HEADER),
        ...(problem.params === undefined ? {} : { params: problem.params }),
        ...(problem.errors === undefined ? {} : { errors: problem.errors }),
      }),
    );
  }

  private log(exception: unknown, status: number): void {
    if (isInstance(exception, PracticeUnavailableError)) {
      this.logger.warn(
        { practiceId: exception.practiceId, reasonCode: exception.reason },
        'practice unavailable',
      );
      return;
    }
    if (isInstance(exception, HttpException)) return;
    if (isInstance(exception, DomainException) && status < 500) return;
    this.logger.error({ err: exception }, 'unknown exception');
  }
}

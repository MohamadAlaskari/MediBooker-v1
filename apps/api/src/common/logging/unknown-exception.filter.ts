import {
  type ArgumentsHost,
  Catch,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';

/** `instanceof HttpException`, false also for a value whose prototype cannot be read (a Proxy). */
function isHttpException(value: unknown): value is HttpException {
  try {
    return value instanceof HttpException;
  } catch {
    return false;
  }
}

/** An error status: 4xx or 5xx. Express throws for a status outside 100 to 999. */
function isErrorStatus(status: number): boolean {
  return Number.isInteger(status) && status >= 400 && status <= 599;
}

/**
 * The global filter for exceptions that are not an HttpException (Nest calls them unknown), until
 * X01's ProblemDetailsFilter takes over this rule (02 §8). It logs such an exception once, at
 * error, with the constant message `unknown exception` and `err` from the error serializer, then
 * answers it as Nest does. Nest's own handler would log `logger.error(exception)`: a thrown string
 * would become the message, the fields of a thrown object would land in the line, and pino would
 * copy an error's message into `msg`; any of them can carry personal data.
 */
@Catch()
export class UnknownExceptionFilter extends BaseExceptionFilter<unknown> {
  constructor(private readonly logger: PinoLogger) {
    super();
    logger.setContext(UnknownExceptionFilter.name);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (isHttpException(exception)) {
      super.catch(exception, host);
      return;
    }
    this.logger.error({ err: exception }, 'unknown exception');
    super.catch(this.answerOf(exception), host);
  }

  /**
   * Nest's answer to an unknown exception (`handleUnknownError`) as an HttpException, which Nest
   * sends without logging: the status and message of an http-errors error such as the body parser's
   * 413, otherwise 500. A status that is not an error status, or a property that throws when Nest's
   * checks read it (a getter), gives 500, so answering never fails and the exception is logged once.
   */
  private answerOf(exception: unknown): HttpException {
    try {
      if (!this.isHttpError(exception) || !isErrorStatus(exception.statusCode)) {
        return new InternalServerErrorException();
      }
      const { statusCode } = exception;
      return new HttpException(
        { statusCode, message: this.getHttpErrorMessage(exception) },
        statusCode,
      );
    } catch {
      return new InternalServerErrorException();
    }
  }
}

import type { ErrorCode } from './error-catalog.js';
import type { FieldError } from './field-error-codes.js';

export interface DomainExceptionOptions {
  /** English text for developers, without personal data. Default: the catalogue's title. */
  readonly detail?: string;
  /** Public values only, for example `{ maxFutureAppointments: 2 }`. */
  readonly params?: Readonly<Record<string, unknown>>;
  readonly fieldErrors?: readonly FieldError[];
  readonly cause?: unknown;
}

/**
 * An expected failure of a service (05 §1.2). The status comes from the catalogue, so a code and a
 * status cannot disagree. Its message is the code, so a log line can never carry other text.
 */
export class DomainException extends Error {
  readonly detail: string | undefined;
  readonly params: Readonly<Record<string, unknown>> | undefined;
  readonly fieldErrors: readonly FieldError[] | undefined;

  constructor(
    readonly code: ErrorCode,
    options: DomainExceptionOptions = {},
  ) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DomainException';
    this.detail = options.detail;
    this.params = options.params;
    this.fieldErrors = options.fieldErrors;
  }
}

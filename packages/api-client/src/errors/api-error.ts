import { ErrorCode } from '../generated/model';

/** The failures the client itself detects; they have messages like the server's codes (05 §1.7). */
export const CLIENT_ERROR_CODES = ['NETWORK_ERROR', 'TIMEOUT', 'UNEXPECTED_RESPONSE'] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

/** A code this version of the client has a message for. */
export type KnownErrorCode = ErrorCode | ClientErrorCode;

export interface ApiFieldError {
  /** The path as the server writes it: `items[0].startsAt`. */
  readonly field: string;
  readonly code: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface ApiErrorInit {
  /** The HTTP status; 0 when no response arrived. */
  readonly status: number;
  /** Kept as a string: a newer server may send a code this client does not know yet. */
  readonly code: string;
  readonly requestId?: string | undefined;
  readonly params?: Readonly<Record<string, unknown>> | undefined;
  readonly fieldErrors?: readonly ApiFieldError[] | undefined;
  readonly cause?: unknown;
}

/** Every failed API call. The server's `detail` is not kept: screens show their own message. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly params: Readonly<Record<string, unknown>> | undefined;
  readonly fieldErrors: readonly ApiFieldError[];

  constructor(init: ApiErrorInit) {
    super(init.code, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.params = init.params;
    this.fieldErrors = init.fieldErrors ?? [];
  }
}

/** Narrows to an ApiError, optionally of one code. */
export function isApiError(error: unknown, code?: KnownErrorCode): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

const KNOWN_CODES: ReadonlySet<string> = new Set([
  ...Object.values(ErrorCode),
  ...CLIENT_ERROR_CODES,
]);

function codeOfStatus(status: number): KnownErrorCode {
  switch (status) {
    case 401:
      return ErrorCode.UNAUTHENTICATED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 429:
      return ErrorCode.RATE_LIMITED;
    default:
      return status >= 500 ? ErrorCode.INTERNAL_ERROR : 'UNEXPECTED_RESPONSE';
  }
}

/** The i18n key of an error; a code from a newer server falls back by status (05 §1.6). */
export function errorMessageKey(error: ApiError): string {
  return `errors.${KNOWN_CODES.has(error.code) ? error.code : codeOfStatus(error.status)}`;
}

/**
 * Hands the field errors to a form: `items[0].startsAt` becomes the react-hook-form path
 * `items.0.startsAt`, and the message is the i18n key of the code. False when there are none.
 */
export function applyFieldErrors(
  error: ApiError,
  setError: (path: string, fieldError: { type: string; message: string }) => void,
): boolean {
  for (const { field, code } of error.fieldErrors) {
    setError(field.replace(/\[(\d+)\]/g, '.$1'), { type: code, message: `validation.${code}` });
  }
  return error.fieldErrors.length > 0;
}

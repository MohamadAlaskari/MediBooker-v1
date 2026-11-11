/**
 * How every part of the API stub answers: JSON, nothing, or problem+json as the API's filter writes
 * it (05 §1.3). The status follows from the code, as in the API's catalogue, so that no part of the
 * stub can answer a code with another status. Typed by the generated client: a new code fails here.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ErrorCode, FieldErrorCode, ProblemDetailsDto } from '@medibooker/api-client';

const STATUS_OF: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_TOKEN: 400,
  MFA_CODE_REQUIRED: 401,
  MFA_CODE_INVALID: 400,
  FORBIDDEN: 403,
  EMAIL_NOT_VERIFIED: 403,
  MFA_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ALREADY_JOINED: 409,
  PATIENT_MAY_EXIST: 409,
  MFA_ALREADY_ENABLED: 409,
  SLOT_NOT_AVAILABLE: 409,
  APPOINTMENT_OVERLAP: 409,
  BOOKING_LIMIT_REACHED: 409,
  OUTSIDE_BOOKING_WINDOW: 409,
  SERVICE_NOT_BOOKABLE: 409,
  PATIENT_PROFILE_INCOMPLETE: 409,
  CANCELLATION_DEADLINE_PASSED: 409,
  INVALID_STATUS_TRANSITION: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  JOIN_LIMIT_REACHED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

/** A test looks for this one on the page of a practice that is unavailable. */
const REQUEST_ID = '30000000-0000-4000-8000-000000000001';

export interface FieldProblem {
  readonly field: string;
  readonly code: FieldErrorCode;
}

/** What the API answers instead of going on. */
export interface Refusal {
  readonly code: ErrorCode;
  readonly errors?: readonly FieldProblem[];
  readonly params?: Readonly<Record<string, unknown>>;
}

export function respond(response: ServerResponse, status: number, body?: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

export function done(response: ServerResponse): void {
  response.writeHead(204);
  response.end();
}

export function problem(
  response: ServerResponse,
  code: ErrorCode,
  { errors, params }: Omit<Refusal, 'code'> = {},
  headers: Readonly<Record<string, string>> = {},
): void {
  const status = STATUS_OF[code];
  const body: ProblemDetailsDto = {
    type: `urn:medibooker:problem:${code.toLowerCase().replaceAll('_', '-')}`,
    title: code,
    status,
    detail: code,
    code,
    requestId: REQUEST_ID,
    ...(params === undefined ? {} : { params }),
    ...(errors === undefined
      ? {}
      : { errors: errors.map((error) => ({ ...error, message: error.code })) }),
  };
  response.writeHead(status, {
    'Content-Type': 'application/problem+json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

export async function bodyOf<Body = Record<string, string | undefined>>(
  request: IncomingMessage,
): Promise<Body> {
  let text = '';
  for await (const chunk of request) text += String(chunk);
  return (text === '' ? {} : JSON.parse(text)) as Body;
}

/** The end of an insurance number that may be shown, as the API keeps it. */
export function numberEndOf(number: string): string {
  const compact = number.replaceAll(/[\s./-]/gu, '');
  const shown = Math.min(4, Math.floor(compact.length / 2));
  return compact.slice(compact.length - shown);
}

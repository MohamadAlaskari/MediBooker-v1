export interface ErrorDefinition {
  readonly status: number;
  /** Constant English text for developers; clients show their own message for the code. */
  readonly title: string;
}

/**
 * The single source of the API's error codes (05 §1.1). A code is never reused with another
 * meaning. Feature codes enter in the commit that first throws them.
 */
export const ERROR_CATALOG = {
  VALIDATION_FAILED: { status: 400, title: 'Validation failed' },
  UNAUTHENTICATED: { status: 401, title: 'Authentication required' },
  FORBIDDEN: { status: 403, title: 'Forbidden' },
  NOT_FOUND: { status: 404, title: 'Not found' },
  CONFLICT: { status: 409, title: 'Conflict' },
  PAYLOAD_TOO_LARGE: { status: 413, title: 'Payload too large' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, title: 'Unsupported media type' },
  RATE_LIMITED: { status: 429, title: 'Too many requests' },
  INTERNAL_ERROR: { status: 500, title: 'Internal error' },
  SERVICE_UNAVAILABLE: { status: 503, title: 'Service unavailable' },
} as const satisfies Readonly<Record<string, ErrorDefinition>>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export const ERROR_CODES = Object.keys(ERROR_CATALOG) as readonly ErrorCode[];

/** The URN of a code, independent of the hosting domain (05 §1.5). */
export function problemTypeOf(code: ErrorCode): string {
  return `urn:medibooker:problem:${code.toLowerCase().replaceAll('_', '-')}`;
}

/** The code of a status that no DomainException chose: by status only (05 §1.3). */
export function errorCodeOfStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return status >= 400 && status < 500 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR';
  }
}

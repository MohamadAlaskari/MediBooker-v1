/** Why one field of a request failed (05 §1.1), with constant English text for developers. */
export const FIELD_ERROR_MESSAGES = {
  REQUIRED: 'Required',
  INVALID_TYPE: 'Invalid type',
  INVALID_FORMAT: 'Invalid format',
  INVALID_VALUE: 'Invalid value',
  TOO_SHORT: 'Too short',
  TOO_LONG: 'Too long',
  TOO_SMALL: 'Too small',
  TOO_LARGE: 'Too large',
  UNKNOWN_FIELD: 'Unknown field',
  PASSWORD_BREACHED: 'Found in a list of breached passwords',
} as const satisfies Readonly<Record<string, string>>;

export type FieldErrorCode = keyof typeof FIELD_ERROR_MESSAGES;

export const FIELD_ERROR_CODES = Object.keys(FIELD_ERROR_MESSAGES) as readonly FieldErrorCode[];

/** One failed field: never the submitted value (05 §1.3). */
export interface FieldError {
  /** camelCase, with brackets for array indices: `items[0].startsAt`. */
  readonly field: string;
  readonly code: FieldErrorCode;
  readonly message: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/** The part of a zod issue that says what went wrong. */
export interface ValidationIssue {
  readonly code?: string;
  readonly input?: unknown;
  readonly origin?: string;
  readonly minimum?: number | bigint;
  readonly maximum?: number | bigint;
}

/** A text of the `validation` catalogue with its values: what the API answers, in the browser. */
export interface ValidationMessage {
  readonly key: 'REQUIRED' | 'TOO_SHORT' | 'TOO_LONG' | 'INVALID_FORMAT' | 'INVALID_VALUE';
  readonly values: Readonly<Record<string, number>>;
}

/**
 * A generated schema knows the rules and zod words them in English, so its issues become the codes
 * of the catalogue. An empty field is a missing one, whichever rule found it.
 */
export function validationMessageOf(issue: ValidationIssue): ValidationMessage {
  if (issue.input === '' || issue.input === undefined) return { key: 'REQUIRED', values: {} };
  if (issue.code === 'too_small') {
    return { key: 'TOO_SHORT', values: { min: Number(issue.minimum) } };
  }
  if (issue.code === 'too_big') {
    return { key: 'TOO_LONG', values: { max: Number(issue.maximum) } };
  }
  if (issue.code === 'invalid_format') return { key: 'INVALID_FORMAT', values: {} };
  return { key: 'INVALID_VALUE', values: {} };
}

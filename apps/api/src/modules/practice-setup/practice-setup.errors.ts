import { DomainException } from '../../common/errors/domain.exception.js';
import { FIELD_ERROR_MESSAGES } from '../../common/errors/field-error-codes.js';
import { MAX_FIELD_ERRORS } from '../../common/errors/validation.js';
import type { FieldProblem } from './domain/practice-setup.rules.js';

/**
 * VALIDATION_FAILED with the fields that failed, never their values, and no more of them than the
 * validation pipe names (05 §1.3).
 */
export function validationFailed(problems: readonly FieldProblem[]): DomainException {
  return new DomainException('VALIDATION_FAILED', {
    fieldErrors: problems.slice(0, MAX_FIELD_ERRORS).map(({ field, code }) => ({
      field,
      code,
      message: FIELD_ERROR_MESSAGES[code],
    })),
  });
}

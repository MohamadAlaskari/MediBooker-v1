import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { DomainException } from './domain.exception.js';
import { FIELD_ERROR_MESSAGES, type FieldError, type FieldErrorCode } from './field-error-codes.js';

/** class-validator's constraint names as field codes (05 §1.4). */
const CONSTRAINT_CODES: Readonly<Record<string, FieldErrorCode>> = {
  isNotEmpty: 'REQUIRED',
  isDefined: 'REQUIRED',
  isString: 'INVALID_TYPE',
  isInt: 'INVALID_TYPE',
  isNumber: 'INVALID_TYPE',
  isBoolean: 'INVALID_TYPE',
  isArray: 'INVALID_TYPE',
  isObject: 'INVALID_TYPE',
  nestedValidation: 'INVALID_TYPE',
  isEmail: 'INVALID_FORMAT',
  isUuid: 'INVALID_FORMAT',
  isIso8601: 'INVALID_FORMAT',
  matches: 'INVALID_FORMAT',
  isIn: 'INVALID_VALUE',
  isEnum: 'INVALID_VALUE',
  minLength: 'TOO_SHORT',
  arrayMinSize: 'TOO_SHORT',
  maxLength: 'TOO_LONG',
  arrayMaxSize: 'TOO_LONG',
  min: 'TOO_SMALL',
  max: 'TOO_LARGE',
  whitelistValidation: 'UNKNOWN_FIELD',
};

/** `params.format` of an INVALID_FORMAT code (05 §1.1). */
const FORMATS: Readonly<Record<string, string>> = {
  isEmail: 'email',
  isUuid: 'uuid',
  isIso8601: 'datetime',
  matches: 'pattern',
};

/** A 100 kB body can name tens of thousands of bad fields; a response never lists more than this. */
export const MAX_FIELD_ERRORS = 100;

/** What a field decorator can say in class-validator's `context`. */
interface FieldErrorContext {
  readonly code?: FieldErrorCode;
  readonly params?: Readonly<Record<string, unknown>>;
}

function pathOf(parent: string, property: string): string {
  if (/^\d+$/.test(property)) return `${parent}[${property}]`;
  return parent === '' ? property : `${parent}.${property}`;
}

function fieldErrorsOf(errors: readonly ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = pathOf(parent, error.property);
    const own = Object.keys(error.constraints ?? {}).map((constraint): FieldError => {
      const context = error.contexts?.[constraint] as FieldErrorContext | undefined;
      const code = context?.code ?? CONSTRAINT_CODES[constraint] ?? 'INVALID_VALUE';
      const format = FORMATS[constraint];
      const params = { ...(format === undefined ? {} : { format }), ...context?.params };
      return {
        field,
        code,
        message: FIELD_ERROR_MESSAGES[code],
        ...(Object.keys(params).length === 0 ? {} : { params }),
      };
    });
    return [...own, ...fieldErrorsOf(error.children ?? [], field)];
  });
}

/** A failed validation as VALIDATION_FAILED with its field errors; never a submitted value. */
export function createValidationException(errors: ValidationError[]): DomainException {
  return new DomainException('VALIDATION_FAILED', {
    fieldErrors: fieldErrorsOf(errors).slice(0, MAX_FIELD_ERRORS),
  });
}

/**
 * The global pipe (02 §4): DTOs are classes, and a property they do not declare is an error, so a
 * `practiceId` in a request body is UNKNOWN_FIELD: the practice comes only from the path. The pipe
 * skips a body typed as an interface or `import type`; a route rule in public-routes.spec.ts fails
 * for one, so every whole `@Body()` and `@Query()` is validated.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: false },
    exceptionFactory: createValidationException,
  });
}

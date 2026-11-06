import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ERROR_CODES, type ErrorCode } from './error-catalog.js';
import { FIELD_ERROR_CODES, type FieldErrorCode } from './field-error-codes.js';

/** One failed field of a request (05 §1). The submitted value never appears. */
export class FieldErrorDto {
  @ApiProperty({ example: 'items[0].startsAt' })
  readonly field!: string;

  @ApiProperty({ enum: FIELD_ERROR_CODES, enumName: 'FieldErrorCode' })
  readonly code!: FieldErrorCode;

  @ApiProperty({ example: 'Too long' })
  readonly message!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  readonly params?: Readonly<Record<string, unknown>>;
}

/** What every error of the API answers, as `application/problem+json` (05 §1.3). */
export class ProblemDetailsDto {
  @ApiProperty({ example: 'urn:medibooker:problem:not-found' })
  readonly type!: string;

  @ApiProperty({ example: 'Not found' })
  readonly title!: string;

  @ApiProperty({ example: 404 })
  readonly status!: number;

  @ApiProperty({ example: 'Not found' })
  readonly detail!: string;

  /** Clients branch on this and show their own message for it. */
  @ApiProperty({ enum: ERROR_CODES, enumName: 'ErrorCode' })
  readonly code!: ErrorCode;

  @ApiProperty({ format: 'uuid' })
  readonly requestId!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  readonly params?: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional({ type: [FieldErrorDto] })
  readonly errors?: readonly FieldErrorDto[];
}

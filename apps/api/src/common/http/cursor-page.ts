import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { DomainException } from '../errors/domain.exception.js';
import { FIELD_ERROR_MESSAGES } from '../errors/field-error-codes.js';

export const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/** The query of every list (02 §6): how many items, and where the page before stopped. */
export class CursorQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  readonly limit: number = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({ type: String, description: 'The nextCursor of the page before' })
  @IsOptional()
  @IsString()
  @Matches(/^[\w-]{1,256}$/)
  readonly cursor?: string;
}

/** The answer of every list (02 §6); `nextCursor` is null on the last page. */
export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** Opaque to a client, so the order behind it can change without a new API version. */
export function encodeCursor(position: string): string {
  return Buffer.from(position, 'utf8').toString('base64url');
}

/** What a list answers to a cursor it cannot use: the same, whatever is wrong with it. */
export function invalidCursor(): DomainException {
  return new DomainException('VALIDATION_FAILED', {
    fieldErrors: [
      {
        field: 'cursor',
        code: 'INVALID_FORMAT',
        message: FIELD_ERROR_MESSAGES.INVALID_FORMAT,
        params: { format: 'pattern' },
      },
    ],
  });
}

/**
 * The position in a cursor. Any text a client encodes decodes, and a NUL byte in it would fail in
 * the database as a 500, so `isPosition` says what a position of this list looks like.
 */
export function decodeCursor(cursor: string, isPosition: (text: string) => boolean): string {
  const position = Buffer.from(cursor, 'base64url').toString('utf8');
  if (isPosition(position)) return position;
  throw invalidCursor();
}

/**
 * A page from `limit + 1` rows: the one row too many is what shows that another page follows, and
 * the next page starts after the last row of this one.
 */
export function cursorPageOf<T>(
  rows: readonly T[],
  limit: number,
  positionOf: (row: T) => string,
): CursorPage<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(positionOf(last)) : null,
  };
}

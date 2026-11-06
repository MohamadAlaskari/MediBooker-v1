import { describe, expect, it } from 'vitest';
import { DomainException } from '../errors/domain.exception.js';
import { cursorPageOf, decodeCursor, encodeCursor } from './cursor-page.js';

const slugOf = (row: { slug: string }): string => row.slug;
const anyText = (): boolean => true;

describe('cursorPageOf', () => {
  const rows = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];

  it('points the next page behind the last item when one row too many came back', () => {
    const page = cursorPageOf(rows, 2, slugOf);
    expect(page.items).toEqual([{ slug: 'a' }, { slug: 'b' }]);
    expect(decodeCursor(page.nextCursor ?? '', anyText)).toBe('b');
  });

  it('ends when exactly the limit came back', () => {
    expect(cursorPageOf(rows, 3, slugOf)).toEqual({ items: rows, nextCursor: null });
  });

  it('ends on an empty result', () => {
    expect(cursorPageOf([], 3, slugOf)).toEqual({ items: [], nextCursor: null });
  });
});

describe('the cursor', () => {
  it.each(['al-noor', 'مركز', ''])(
    'round-trips %j, with no character a URL must escape',
    (text) => {
      const cursor = encodeCursor(text);
      expect(cursor).toMatch(/^[\w-]*$/);
      expect(decodeCursor(cursor, anyText)).toBe(text);
    },
  );

  it('refuses what is no position of the list, such as a NUL byte, as a validation error', () => {
    const noNulByte = (text: string): boolean => !text.includes('\0');
    expect(() => decodeCursor('AA', noNulByte)).toThrow(DomainException);
    expect(() => decodeCursor('AA', noNulByte)).toThrow('VALIDATION_FAILED');
  });
});

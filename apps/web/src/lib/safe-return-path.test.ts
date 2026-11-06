import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './safe-return-path';

describe('safeReturnPath', () => {
  it.each(['/ar', '/en/', '/en/al-noor', '/ar/al-noor/book'])('accepts %s', (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each([
    '//evil.example',
    '/\\evil.example',
    '/%2F%2Fevil.example',
    '/en/%2F%2Fevil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/de/al-noor',
    '/en//evil.example',
    '/en/AL-NOOR',
    '/en/../evil',
    '/en?',
    '/en/al-noor?next=https://evil.example',
    '/en/al-noor#fragment',
    '/en\n',
    '/\t/evil.example',
    '/en/\uFF0Fevil',
    `/en/${'a'.repeat(512)}`,
    '',
  ])('rejects %j', (path) => {
    expect(safeReturnPath(path)).toBeUndefined();
  });

  it('rejects no value at all', () => {
    expect(safeReturnPath(null)).toBeUndefined();
    expect(safeReturnPath(undefined)).toBeUndefined();
  });
});

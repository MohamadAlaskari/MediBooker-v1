import { describe, expect, it } from 'vitest';
import { assertPracticeId, ObjectKey } from './object-key.js';

const PRACTICE_ID = '0a1b2c3d-0000-4000-8000-00000000000f';

describe('ObjectKey', () => {
  it('holds a practice and a path of ids', () => {
    expect(ObjectKey.of(PRACTICE_ID, 'attachments/5f0e/original')).toMatchObject({
      practiceId: PRACTICE_ID,
      path: 'attachments/5f0e/original',
    });
  });

  it('takes a path of one segment and of the longest allowed length', () => {
    expect(ObjectKey.of(PRACTICE_ID, 'logo').path).toBe('logo');
    const longest = 'a'.repeat(200);
    expect(ObjectKey.of(PRACTICE_ID, longest).path).toBe(longest);
  });

  it.each([
    ['an empty path', ''],
    ['a path over 200 characters', 'a'.repeat(201)],
    ['a leading slash', '/attachments'],
    ['a trailing slash', 'attachments/'],
    ['two slashes', 'attachments//first'],
    ['traversal', '../other-practice/first'],
    ['a dot, which a file name has', 'attachments/first.pdf'],
    ['upper case', 'Attachments/first'],
    ['a space', 'attachments/blood test'],
    ['Arabic', 'مرفقات/أول'],
    ['encoding', 'attachments/%2e%2e'],
    ['a backslash', 'attachments\\first'],
    ['a query', 'attachments?first'],
    ['a new line after a valid path', 'attachments\n'],
  ])('refuses %s', (_name, path) => {
    expect(() => ObjectKey.of(PRACTICE_ID, path)).toThrow(new TypeError('not an object path'));
  });

  it.each([
    ['an empty id', ''],
    ['no UUID', 'practice-1'],
    ['upper case, which would be another container', PRACTICE_ID.toUpperCase()],
    ['traversal', `../${PRACTICE_ID}`],
    ['a new line after a valid id', `${PRACTICE_ID}\n`],
  ])('refuses %s as a practice', (_name, practiceId) => {
    expect(() => ObjectKey.of(practiceId, 'logo')).toThrow(new TypeError('not a practice id'));
    expect(() => {
      assertPracticeId(practiceId);
    }).toThrow(TypeError);
  });

  it('comes only from `of`, which the compiler holds to', () => {
    // @ts-expect-error -- an object with the same fields has passed no check
    const forged: ObjectKey = { practiceId: '../other', path: 'blood test.pdf' };
    expect(forged).not.toBeInstanceOf(ObjectKey);
  });

  it('never repeats a refused value, which could be a patient file name', () => {
    expect(() => ObjectKey.of(PRACTICE_ID, 'blood test.pdf')).toThrow('not an object path');
    expect(() => ObjectKey.of('blood test.pdf', 'logo')).toThrow('not a practice id');
  });
});

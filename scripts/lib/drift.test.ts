import { describe, expect, it } from 'vitest';
import { driftProblems, GENERATED_FILES, linesOf } from './drift.ts';

describe('driftProblems', () => {
  it('reports nothing for files that match git', () => {
    expect(driftProblems([], [])).toEqual([]);
  });

  it('names a changed file and an untracked one', () => {
    const [changed, untracked] = driftProblems(['a.json'], ['b.json']);
    expect(changed).toContain('a.json: differs');
    expect(untracked).toContain('b.json: is generated but not in git');
  });
});

describe('linesOf', () => {
  it('reads the lines of a git output, also with CRLF, without blanks', () => {
    expect(linesOf('a.json\r\n\nb.json\n')).toEqual(['a.json', 'b.json']);
    expect(linesOf('')).toEqual([]);
  });
});

describe('GENERATED_FILES', () => {
  it('names the OpenAPI document', () => {
    expect(GENERATED_FILES).toContain('apps/api/openapi.json');
  });
});

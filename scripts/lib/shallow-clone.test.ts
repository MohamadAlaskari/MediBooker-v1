import { describe, expect, it } from 'vitest';
import {
  SHALLOW_CLONE_MESSAGE,
  shallowCloneFailure,
  type ShallowCheckRun,
  UNKNOWN_DEPTH_MESSAGE,
} from './shallow-clone.ts';

/** `git rev-parse --is-shallow-repository` that exited with the given code and output. */
function answered(stdout: string, status = 0): ShallowCheckRun {
  return { status, stdout };
}

describe('shallowCloneFailure', () => {
  it.each(['false\n', 'false\r\n', 'false'])('passes a full clone (git printed %j)', (stdout) => {
    expect(shallowCloneFailure(answered(stdout))).toBeUndefined();
  });

  it('fails a shallow clone and names the fix', () => {
    expect(shallowCloneFailure(answered('true\n'))).toBe(SHALLOW_CLONE_MESSAGE);
    expect(SHALLOW_CLONE_MESSAGE).toContain('fetch-depth: 0');
  });

  it.each([
    ['git exits 128 (not a git repository)', answered('', 128)],
    ['git is missing', { error: new Error('spawnSync git ENOENT'), status: null, stdout: '' }],
    [
      'git echoes the option it does not know (git before 2.15)',
      answered('--is-shallow-repository\n'),
    ],
    ['git prints something else', answered('False\n')],
    ['git prints nothing', answered('')],
    ['git prints more than the answer', answered('false\nfalse\n')],
  ] satisfies [string, ShallowCheckRun][])('fails closed when %s', (_situation, run) => {
    expect(shallowCloneFailure(run)).toBe(UNKNOWN_DEPTH_MESSAGE);
  });
});

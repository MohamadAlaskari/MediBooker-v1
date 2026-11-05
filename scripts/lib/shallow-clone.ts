/**
 * The range and history scans need the full history: in a shallow clone, `git log` sees only the
 * fetched commits, so both scans would pass a secret in a commit that the clone does not hold,
 * for example after a checkout without `fetch-depth: 0` (07 §4).
 */
import type { SpawnSyncReturns } from 'node:child_process';

/** The result of `git rev-parse --is-shallow-repository`, which prints `true` or `false`. */
export type ShallowCheckRun = Pick<SpawnSyncReturns<string>, 'error' | 'status' | 'stdout'>;

export const SHALLOW_CLONE_MESSAGE = [
  'The clone is shallow, so the secret scan would miss the commits it does not hold.',
  'Check out the full history (actions/checkout with fetch-depth: 0). The secret scan failed.',
].join('\n');

export const UNKNOWN_DEPTH_MESSAGE = [
  'git could not tell whether the clone is shallow (git rev-parse --is-shallow-repository),',
  'so the secret scan could miss commits. The secret scan failed.',
].join('\n');

/**
 * Why the scan must not run, or undefined when git printed exactly `false`: a shallow clone, a
 * git that failed, or any other answer (an old git echoes the unknown option) fails closed.
 */
export function shallowCloneFailure(run: ShallowCheckRun): string | undefined {
  if (run.error !== undefined || run.status !== 0) {
    return UNKNOWN_DEPTH_MESSAGE;
  }
  const answer = run.stdout.replace(/\r?\n$/, '');
  if (answer === 'false') {
    return undefined;
  }
  return answer === 'true' ? SHALLOW_CLONE_MESSAGE : UNKNOWN_DEPTH_MESSAGE;
}

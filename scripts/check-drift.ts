/**
 * `pnpm check:drift`, after `pnpm generate`: fails when a generated file differs from what git has
 * staged or committed, or is not in git at all (08 X02). In `verify` and the CI `quality` job.
 */
import { execFileSync } from 'node:child_process';
import { driftProblems, GENERATED_FILES, linesOf } from './lib/drift.ts';

function git(...args: readonly string[]): string[] {
  return linesOf(execFileSync('git', [...args, '--', ...GENERATED_FILES], { encoding: 'utf8' }));
}

const problems = driftProblems(
  git('diff', '--name-only'),
  git('ls-files', '--others', '--exclude-standard'),
);
for (const problem of problems) console.error(problem);
if (problems.length > 0) process.exit(1);
console.log(`check-drift: ${String(GENERATED_FILES.length)} generated file(s) are current.`);

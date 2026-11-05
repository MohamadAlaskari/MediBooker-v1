/**
 * `pnpm verify`: checks that the git hooks are installed and match lefthook.yml. Without them, a
 * commit would skip the secret scan and the commit-message check.
 * LEFTHOOK=0 or false switches the hooks off; lefthook 2.2.2 honours exactly these two values, in
 * `lefthook run` only, and its check-install still fails on a checkout without hooks. CI sets
 * LEFTHOOK=0 and has no hooks, so with CI=true the check is skipped. On any other machine the
 * switch fails the check, because commits would then skip the secret scan.
 * Usage: node scripts/check-hooks.ts
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const lefthook = path.join(repoRoot, 'node_modules', 'lefthook', 'bin', 'index.js');

const HOOKS_HINT = [
  'The git hooks are missing or out of date, so a commit would skip the secret scan and the',
  'commit-message check. Install them with: pnpm exec lefthook install',
  '(after pnpm install if node_modules is missing).',
].join('\n');

const lefthookSwitch = process.env.LEFTHOOK;
const hooksSwitchedOff = lefthookSwitch === '0' || lefthookSwitch === 'false';

if (hooksSwitchedOff && process.env.CI !== 'true') {
  console.error(
    [
      `LEFTHOOK=${lefthookSwitch} switches the git hooks off, so commits skip the secret scan and`,
      'the commit-message check. Unset it: only CI sets it (docs/dev/getting-started.md).',
    ].join('\n'),
  );
  process.exitCode = 1;
} else if (!hooksSwitchedOff) {
  const run = spawnSync(process.execPath, [lefthook, 'check-install'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (run.status !== 0) {
    console.error(HOOKS_HINT);
    process.exitCode = 1;
  }
}

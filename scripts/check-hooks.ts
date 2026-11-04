/**
 * `pnpm verify`: checks that the git hooks are installed and match lefthook.yml. Without them, a
 * commit would skip the secret scan and the commit-message check. With LEFTHOOK=0, which only CI
 * sets, lefthook reports success without checking.
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

const run = spawnSync(process.execPath, [lefthook, 'check-install'], {
  cwd: repoRoot,
  stdio: 'inherit',
});
if (run.status !== 0) {
  console.error(HOOKS_HINT);
  process.exitCode = 1;
}

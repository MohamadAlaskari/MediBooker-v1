/**
 * pre-commit hook and `pnpm verify`: checks .gitleaksignore against the pinned list, then scans
 * the staged changes for secrets with gitleaks, using the repository's .gitleaks.toml. Fails
 * closed: a .gitleaksignore that differs from the pinned list, or a missing gitleaks, blocks the
 * commit.
 * Usage: node scripts/run-gitleaks.ts
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  checkIgnoreFile,
  runGitleaks,
  stagedScanArguments,
  toScanOutcome,
  type ScanOutcome,
} from './lib/gitleaks.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');

function main(): ScanOutcome {
  // gitleaks reads .gitleaksignore in the scan below, so the file must match the pin first. This
  // needs no gitleaks: a mismatch blocks the commit also where gitleaks is missing.
  const pinFailure = checkIgnoreFile(repoRoot);
  if (pinFailure !== undefined) {
    return { exitCode: 1, message: `${pinFailure}\nThe commit is blocked.` };
  }
  // Read-only: exits 0 when nothing is staged, so the scan below has nothing to check.
  const stagedCheck = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: repoRoot });
  return toScanOutcome(runGitleaks(repoRoot, stagedScanArguments(repoRoot)), stagedCheck);
}

const outcome = main();
if (outcome.message !== undefined) {
  console.error(outcome.message);
}
process.exitCode = outcome.exitCode;

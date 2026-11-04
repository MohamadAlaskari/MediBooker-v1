/**
 * pre-commit hook and `pnpm verify`: scans the staged changes for secrets with gitleaks, using the
 * repository's .gitleaks.toml. Fails closed: without gitleaks, the commit is blocked.
 * Usage: node scripts/run-gitleaks.ts
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { stagedScanArguments, toScanOutcome } from './lib/gitleaks.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');

// Read-only: exits 0 when nothing is staged, so the scan below has nothing to check.
const stagedCheck = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: repoRoot });
const scan = spawnSync('gitleaks', stagedScanArguments(repoRoot), { stdio: 'inherit' });

const outcome = toScanOutcome(scan, stagedCheck);
if (outcome.message !== undefined) {
  console.error(outcome.message);
}
process.exitCode = outcome.exitCode;

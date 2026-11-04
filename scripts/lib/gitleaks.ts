/** The gitleaks options and the outcome of the staged secret scan. The scan fails closed. */
import type { SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';

export interface ScanOutcome {
  exitCode: number;
  message?: string;
}

/** The fields of a spawnSync result that decide the outcome. */
export type GitleaksRun = Pick<SpawnSyncReturns<unknown>, 'error' | 'status' | 'signal'>;

/** The result of `git diff --cached --quiet`: exit 0 means that nothing is staged. */
export type StagedCheckRun = Pick<SpawnSyncReturns<unknown>, 'error' | 'status'>;

export const INSTALL_HINT = [
  'gitleaks is not installed or not on PATH, so the secret scan cannot run. The commit is blocked.',
  'Install gitleaks 8.30.1 or later and open a new terminal (docs/dev/getting-started.md):',
  '  Windows: the release zip from https://github.com/gitleaks/gitleaks/releases, after checking',
  '           its SHA-256 against the checksums file; or scoop install gitleaks; or choco install gitleaks',
  '  macOS:   brew install gitleaks',
  '  Linux:   the release binary from https://github.com/gitleaks/gitleaks/releases, after checking',
  '           its SHA-256 against the checksums file',
].join('\n');

export const FINDING_HINT = [
  'The secret scan failed, so the commit is blocked. gitleaks printed the reason above.',
  'Remove the secret from the staged changes and load it from the environment instead.',
  'A secret that was ever committed or pushed must be rotated; deleting it is not enough.',
  'Placeholders such as changeme, <...> or ${VAR} are allowed (docs/dev/getting-started.md).',
].join('\n');

export const NOTHING_STAGED_NOTE =
  'Nothing is staged, so the secret scan checked nothing. Stage your changes, then run pnpm verify again.';

/**
 * Options of every gitleaks scan in this repository: its .gitleaks.toml, secrets masked in all
 * output, and inline `gitleaks:allow` comments ignored, so that only a reviewed change to
 * .gitleaks.toml or .gitleaksignore can silence a finding. gitleaks reads .gitleaksignore from the
 * scan root whatever --gitleaks-ignore-path says; F02 pins it to the two accepted fingerprints.
 */
export function policyArguments(repoRoot: string): string[] {
  return [
    '--config',
    path.join(repoRoot, '.gitleaks.toml'),
    '--redact',
    '--ignore-gitleaks-allow',
    '--no-banner',
  ];
}

/** Arguments of the pre-commit scan: only the staged changes, each finding printed. */
export function stagedScanArguments(repoRoot: string): string[] {
  return [
    'git',
    '--pre-commit',
    '--staged',
    ...policyArguments(repoRoot),
    '--verbose',
    '--gitleaks-ignore-path',
    repoRoot,
    repoRoot,
  ];
}

/**
 * Decides the exit code of the secret scan from the gitleaks run and from the staged check that
 * ran before it. A missing binary, a start error or a signal blocks the commit; a finding keeps
 * gitleaks' exit code. A clean scan of an empty index says that it checked nothing.
 */
export function toScanOutcome(scan: GitleaksRun, stagedCheck: StagedCheckRun): ScanOutcome {
  if (scan.error !== undefined) {
    const message = isMissingBinary(scan.error)
      ? INSTALL_HINT
      : `gitleaks could not start (${scan.error.message}). The commit is blocked.`;
    return { exitCode: 1, message };
  }
  if (scan.status === null) {
    const signal = scan.signal ?? 'a signal';
    return { exitCode: 1, message: `gitleaks was stopped by ${signal}. The commit is blocked.` };
  }
  if (scan.status !== 0) {
    return { exitCode: scan.status, message: FINDING_HINT };
  }
  return isNothingStaged(stagedCheck)
    ? { exitCode: 0, message: NOTHING_STAGED_NOTE }
    : { exitCode: 0 };
}

/** Only a clean exit of `git diff --cached --quiet` proves an empty index; errors prove nothing. */
function isNothingStaged(stagedCheck: StagedCheckRun): boolean {
  return stagedCheck.error === undefined && stagedCheck.status === 0;
}

function isMissingBinary(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT';
}

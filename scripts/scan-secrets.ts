/**
 * The secret scans of CI (docs/architecture/07-docker-ci-cd.md §4), also runnable locally. Every
 * mode that reads .gitleaksignore checks it against ACCEPTED_FINGERPRINTS first, the range and
 * history scans refuse a shallow clone, and every mode fails closed: a missing gitleaks, a start
 * error, a signal or a logged error exits 1.
 * Usage: node scripts/scan-secrets.ts <pin | range | history | self-test> [--sarif <file>]
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ACCEPTED_FINGERPRINTS,
  checkIgnoreFile,
  gitleaksEnvironment,
  historyScanArguments,
  IGNORE_FILE,
  rangeScanArguments,
  runGitleaks,
  stdinScanArguments,
  toRepositoryScanOutcome,
  type ReportFile,
} from './lib/gitleaks.ts';
import { scanRange, type ScanEvent } from './lib/scan-range.ts';
import { createSelfTestCases, selfTestFailure, type SelfTestCase } from './lib/secret-self-test.ts';
import { shallowCloneFailure } from './lib/shallow-clone.ts';

// The repository is the directory above this script. On purpose, no environment variable or
// option can move it, the config or the ignore file: that would let a scan skip the pinned file.
const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const USAGE = [
  'Usage: node scripts/scan-secrets.ts <mode> [--sarif <file>]',
  '',
  '  pin        check .gitleaksignore against ACCEPTED_FINGERPRINTS (scripts/lib/gitleaks.ts)',
  '  range      the pin check, then gitleaks over the commits of this push or pull request,',
  '             chosen from GITHUB_EVENT_NAME, GITHUB_SHA, SCAN_BEFORE, SCAN_BASE_SHA and',
  '             SCAN_HEAD_SHA (scripts/lib/scan-range.ts)',
  '  history    the pin check, then gitleaks over the full history (every branch and tag)',
  '  self-test  gitleaks must report and redact two secrets generated at run time',
  '',
  'range and history need the full history: they fail in a shallow clone.',
  '  --sarif <file>  range and history only: also write a redacted SARIF report to <file>',
].join('\n');

type Command =
  { mode: 'pin' | 'self-test' } | { mode: 'range' | 'history'; report: ReportFile | undefined };

function main(args: readonly string[]): number {
  const command = parseCommand(args);
  if (command === undefined) {
    console.error(USAGE);
    return 2;
  }
  switch (command.mode) {
    case 'pin':
      return checkPin();
    case 'self-test':
      return runSelfTest();
    case 'range':
    case 'history': {
      const pinExitCode = checkPin();
      if (pinExitCode !== 0) {
        return pinExitCode;
      }
      const cloneExitCode = checkFullClone();
      if (cloneExitCode !== 0) {
        return cloneExitCode;
      }
      return command.mode === 'range'
        ? scanCommitRange(command.report)
        : scanHistory(command.report);
    }
  }
}

/** The command, or undefined for any other command line (usage, exit 2). */
function parseCommand(args: readonly string[]): Command | undefined {
  const [mode, ...options] = args;
  if (mode === 'pin' || mode === 'self-test') {
    return options.length === 0 ? { mode } : undefined;
  }
  if (mode !== 'range' && mode !== 'history') {
    return undefined;
  }
  if (options.length === 0) {
    return { mode, report: undefined };
  }
  const [option, file] = options;
  // A file name that starts with - would read as an option (gitleaks takes - as stdout).
  return options.length === 2 && option === '--sarif' && file !== undefined && /^[^-]/.test(file)
    ? { mode, report: { format: 'sarif', path: path.resolve(file) } }
    : undefined;
}

function checkPin(): number {
  const failure = checkIgnoreFile(REPO_ROOT);
  if (failure !== undefined) {
    console.error(failure);
    return 1;
  }
  const count = String(ACCEPTED_FINGERPRINTS.length);
  console.log(`${IGNORE_FILE} holds exactly the ${count} fingerprints of ACCEPTED_FINGERPRINTS.`);
  return 0;
}

/** Read-only. git's own error, such as "not a git repository", goes to stderr. */
function checkFullClone(): number {
  const run = spawnSync('git', ['rev-parse', '--is-shallow-repository'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  });
  const failure = shallowCloneFailure(run);
  if (failure !== undefined) {
    console.error(failure);
    return 1;
  }
  return 0;
}

function scanCommitRange(report: ReportFile | undefined): number {
  const range = scanRange(eventFromEnvironment(), hasCommit);
  return scanRepository(
    `${range.revisions} (${range.reason})`,
    rangeScanArguments(REPO_ROOT, range.revisions, report),
  );
}

function scanHistory(report: ReportFile | undefined): number {
  return scanRepository(
    'the full history: every branch and tag of the clone',
    historyScanArguments(REPO_ROOT, report),
  );
}

function scanRepository(scope: string, gitleaksArguments: string[]): number {
  console.log(`Secret scan of ${scope}.`);
  const outcome = toRepositoryScanOutcome(runGitleaks(REPO_ROOT, gitleaksArguments));
  if (outcome.message !== undefined) {
    console.error(outcome.message);
  }
  return outcome.exitCode;
}

/** GitHub Actions sets GITHUB_*; the workflow step sets SCAN_* from `github.event`. */
function eventFromEnvironment(): ScanEvent {
  const { env } = process;
  return {
    eventName: env.GITHUB_EVENT_NAME ?? '',
    sha: env.GITHUB_SHA ?? '',
    before: env.SCAN_BEFORE ?? '',
    baseSha: env.SCAN_BASE_SHA ?? '',
    headSha: env.SCAN_HEAD_SHA ?? '',
  };
}

/** Read-only: whether the clone has the commit. */
function hasCommit(revision: string): boolean {
  const run = spawnSync('git', ['cat-file', '-e', `${revision}^{commit}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
  return run.error === undefined && run.status === 0;
}

/** Never prints a generated value, and deletes its directory also when a case fails. */
function runSelfTest(): number {
  const workDirectory = mkdtempSync(path.join(tmpdir(), 'medibooker-secret-self-test-'));
  try {
    let exitCode = 0;
    for (const testCase of createSelfTestCases()) {
      const failure = runSelfTestCase(testCase, workDirectory);
      if (failure === undefined) {
        console.log(
          `Self-test: gitleaks reported the generated ${testCase.ruleId} value, redacted.`,
        );
      } else {
        console.error(`Self-test failed: ${failure}`);
        exitCode = 1;
      }
    }
    return exitCode;
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
}

function runSelfTestCase(testCase: SelfTestCase, workDirectory: string): string | undefined {
  const report: ReportFile = { format: 'json', path: path.join(workDirectory, 'report.json') };
  // The working directory holds no .gitleaksignore, so gitleaks reads none. The output is kept
  // here, never printed: selfTestFailure checks that it does not show the value.
  const run = spawnSync('gitleaks', stdinScanArguments(REPO_ROOT, report), {
    cwd: workDirectory,
    env: gitleaksEnvironment(process.env),
    input: testCase.input,
    encoding: 'utf8',
  });
  const failure = selfTestFailure(testCase, { ...run, report: readReport(report.path) });
  rmSync(report.path, { force: true });
  return failure;
}

/** The report's text, or '' when gitleaks wrote none: the check then fails. */
function readReport(reportPath: string): string {
  try {
    return readFileSync(reportPath, 'utf8');
  } catch {
    return '';
  }
}

process.exitCode = main(process.argv.slice(2));

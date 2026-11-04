import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FINDING_HINT,
  INSTALL_HINT,
  NOTHING_STAGED_NOTE,
  policyArguments,
  stagedScanArguments,
  toScanOutcome,
  type StagedCheckRun,
} from './gitleaks.ts';

const REPO_ROOT = path.join('synthetic', 'repo root');

/** `git diff --cached --quiet` exits 1 when something is staged and 0 when nothing is. */
const SOMETHING_STAGED: StagedCheckRun = { status: 1 };
const NOTHING_STAGED: StagedCheckRun = { status: 0 };

function spawnError(code: string): Error {
  return Object.assign(new Error(`spawnSync gitleaks ${code}`), { code });
}

describe('stagedScanArguments', () => {
  const args = stagedScanArguments(REPO_ROOT);

  it('scans only the staged changes of the repository (gitleaks git --pre-commit --staged)', () => {
    expect(args.slice(0, 3)).toEqual(['git', '--pre-commit', '--staged']);
    expect(args.at(-1)).toBe(REPO_ROOT);
  });

  it('uses the repository policy: its .gitleaks.toml, --redact and --ignore-gitleaks-allow', () => {
    expect(args).toEqual(expect.arrayContaining(policyArguments(REPO_ROOT)));
  });
});

describe('policyArguments', () => {
  const args = policyArguments(REPO_ROOT);

  it("reads the repository's .gitleaks.toml", () => {
    expect(args[args.indexOf('--config') + 1]).toBe(path.join(REPO_ROOT, '.gitleaks.toml'));
  });

  it('masks secrets in all output', () => {
    expect(args).toContain('--redact');
  });

  it('ignores inline gitleaks:allow comments, so a comment cannot allow a finding', () => {
    expect(args).toContain('--ignore-gitleaks-allow');
  });
});

describe('toScanOutcome', () => {
  it('passes a clean scan of staged changes (exit 0) without a message', () => {
    expect(toScanOutcome({ status: 0, signal: null }, SOMETHING_STAGED)).toEqual({ exitCode: 0 });
  });

  it('passes a clean scan of an empty index with a note that it checked nothing', () => {
    expect(toScanOutcome({ status: 0, signal: null }, NOTHING_STAGED)).toEqual({
      exitCode: 0,
      message: NOTHING_STAGED_NOTE,
    });
  });

  it('adds no note when the staged check itself failed', () => {
    const failedCheck: StagedCheckRun = { error: spawnError('ENOENT'), status: null };
    expect(toScanOutcome({ status: 0, signal: null }, failedCheck)).toEqual({ exitCode: 0 });
    expect(toScanOutcome({ status: 0, signal: null }, { status: 128 })).toEqual({ exitCode: 0 });
  });

  it('blocks the commit when gitleaks reports a finding (exit 1)', () => {
    expect(toScanOutcome({ status: 1, signal: null }, SOMETHING_STAGED)).toEqual({
      exitCode: 1,
      message: FINDING_HINT,
    });
  });

  it('keeps any other non-zero exit code of gitleaks', () => {
    expect(toScanOutcome({ status: 126, signal: null }, SOMETHING_STAGED).exitCode).toBe(126);
  });

  it('fails closed with the install hint when the gitleaks binary is missing (ENOENT)', () => {
    const missing = { error: spawnError('ENOENT'), status: null, signal: null };
    expect(toScanOutcome(missing, SOMETHING_STAGED)).toEqual({
      exitCode: 1,
      message: INSTALL_HINT,
    });
    expect(toScanOutcome(missing, NOTHING_STAGED)).toEqual({ exitCode: 1, message: INSTALL_HINT });
  });

  it('names an install route for Windows, macOS and Linux in the install hint', () => {
    expect(INSTALL_HINT).toMatch(/Windows: .*release zip.*SHA-256.*scoop install.*choco install/s);
    expect(INSTALL_HINT).toContain('macOS:   brew install gitleaks');
    expect(INSTALL_HINT).toMatch(/Linux: .*release binary/);
  });

  it('fails closed when gitleaks cannot start for another reason', () => {
    const outcome = toScanOutcome(
      { error: spawnError('EACCES'), status: null, signal: null },
      SOMETHING_STAGED,
    );
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toContain('spawnSync gitleaks EACCES');
  });

  it('fails closed when gitleaks is stopped by a signal', () => {
    expect(toScanOutcome({ status: null, signal: 'SIGTERM' }, SOMETHING_STAGED)).toEqual({
      exitCode: 1,
      message: 'gitleaks was stopped by SIGTERM. The commit is blocked.',
    });
  });
});

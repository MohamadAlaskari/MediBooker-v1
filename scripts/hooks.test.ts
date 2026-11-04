/**
 * Proves the git hook wiring in lefthook.yml with the lefthook binary itself, and the hook check
 * of `pnpm verify`. Nothing is installed or staged: lefthook runs the configured commands
 * directly, and the repository's hooks stay as they are.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const LEFTHOOK = path.join(REPO_ROOT, 'node_modules', 'lefthook', 'bin', 'index.js');
const CHECK_HOOKS = path.join(import.meta.dirname, 'check-hooks.ts');

let tempDir = '';

beforeAll(() => {
  // A space in the path proves that the hooks quote the file names that git passes to them.
  tempDir = mkdtempSync(path.join(tmpdir(), 'medibooker hooks-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/**
 * The current environment plus the given variables, without the LEFTHOOK switch that CI sets to 0
 * to turn lefthook off. Windows spells variable names in any case, so drop every casing.
 */
function testEnvironment(variables: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const entries = Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'LEFTHOOK');
  return { ...Object.fromEntries(entries), ...variables };
}

function runLefthook(args: string[]) {
  return spawnSync(process.execPath, [LEFTHOOK, ...args], {
    cwd: REPO_ROOT,
    env: testEnvironment(),
    encoding: 'utf8',
  });
}

/** lefthook.yml as lefthook reads it, merged with any local override. */
function lefthookConfig(): unknown {
  const run = runLefthook(['dump', '--format', 'json']);
  if (run.status !== 0) {
    throw new Error(`lefthook dump failed:\n${run.stdout}${run.stderr}`);
  }
  return JSON.parse(run.stdout);
}

function runCommitMsgHook(message: string) {
  const messageFile = path.join(tempDir, 'COMMIT_EDITMSG');
  writeFileSync(messageFile, message);
  return runLefthook(['run', 'commit-msg', messageFile, '--no-auto-install', '--no-tty']);
}

describe('lefthook.yml', () => {
  it('passes lefthook validate', () => {
    const run = runLefthook(['validate']);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });

  it('makes the installed hooks block the commit when they cannot find lefthook', () => {
    expect(lefthookConfig()).toMatchObject({ assert_lefthook_installed: true });
  });

  it('runs the secret scan (scripts/run-gitleaks.ts) in the pre-commit hook, never skipped', () => {
    const config = lefthookConfig();
    expect(config).toMatchObject({
      'pre-commit': { commands: { secrets: { run: 'node scripts/run-gitleaks.ts' } } },
    });
    expect(config).not.toHaveProperty(['pre-commit', 'skip']);
    expect(config).not.toHaveProperty(['pre-commit', 'commands', 'secrets', 'skip']);
  });

  it('commit-msg: rejects "update stuff"', () => {
    const run = runCommitMsgHook('update stuff\n');
    expect(run.status).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain('Commit message rejected');
  });

  it('commit-msg: accepts "chore(repo): add tooling"', () => {
    const run = runCommitMsgHook('chore(repo): add tooling\n');
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });
});

describe('scripts/check-hooks.ts', () => {
  function runCheckHooks(environment: NodeJS.ProcessEnv) {
    return spawnSync(process.execPath, [CHECK_HOOKS], { env: environment, encoding: 'utf8' });
  }

  it('fails with an install hint when the hooks do not match the config', () => {
    // Hooks installed for lefthook.yml are out of date for any other config.
    const otherConfig = path.join(tempDir, 'lefthook.yml');
    writeFileSync(otherConfig, 'pre-push:\n  commands:\n    noop:\n      run: node --version\n');
    const run = runCheckHooks(testEnvironment({ LEFTHOOK_CONFIG: otherConfig }));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Install them with: pnpm exec lefthook install');
  });

  it('passes without checking when LEFTHOOK=0 (CI, which has no hooks)', () => {
    const run = runCheckHooks(testEnvironment({ LEFTHOOK: '0' }));
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
  });
});

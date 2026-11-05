/**
 * Proves scripts/run-gitleaks.ts, the staged scan of the pre-commit hook and `pnpm verify`. The
 * staged-file case runs the real binary in a throw-away repository: without gitleaks it skips
 * locally and fails in CI, as in gitleaks-config.test.ts. The generated value is never printed.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACCEPTED_FINGERPRINTS, STAGED_INSTALL_HINT } from './lib/gitleaks.ts';
import {
  commitFile,
  copyScriptsInto,
  createRepository,
  environmentWithoutTools,
  generatedPasswordAssignment,
  git,
  THIRD_ENTRY,
} from './test-support/scan-fixtures.ts';

const SCRIPT = path.join(import.meta.dirname, 'run-gitleaks.ts');

/** Locally the gitleaks case skips without gitleaks; in CI it fails, so it always runs there. */
const IN_CI = process.env.CI === 'true';
const GITLEAKS_INSTALLED = spawnSync('gitleaks', ['version']).error === undefined;
const SKIP_NOTE =
  'gitleaks is not on PATH; install it (docs/dev/getting-started.md), then run pnpm test --force. CI installs it.';

let tempDir = '';
let emptyDir = '';

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'medibooker-run-gitleaks-'));
  emptyDir = mkdtempSync(path.join(tempDir, 'empty-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function runHook(script: string, cwd: string, env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [script], { cwd, env, encoding: 'utf8' });
}

describe('scripts/run-gitleaks.ts', () => {
  it('fails closed: exits 1 with the install hint when gitleaks is not on PATH', () => {
    const run = runHook(SCRIPT, emptyDir, environmentWithoutTools(process.env, emptyDir));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(STAGED_INSTALL_HINT);
  });

  it('blocks the commit with the pin message when .gitleaksignore has a third entry, also without gitleaks', () => {
    // The copied script reads the copied .gitleaksignore: it finds the repository root next to it.
    const copyRoot = mkdtempSync(path.join(tempDir, 'copy-'));
    copyScriptsInto(copyRoot, [...ACCEPTED_FINGERPRINTS, THIRD_ENTRY]);
    const run = runHook(
      path.join(copyRoot, 'scripts', 'run-gitleaks.ts'),
      emptyDir,
      environmentWithoutTools(process.env, emptyDir),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('.gitleaksignore does not match ACCEPTED_FINGERPRINTS');
    expect(run.stderr).toContain(`Unexpected entries:\n  line 4: ${THIRD_ENTRY}`);
    expect(run.stderr).toContain('The commit is blocked.');
    expect(run.stderr).not.toContain(STAGED_INSTALL_HINT);
  });

  describe('with gitleaks', () => {
    beforeEach((context) => {
      context.skip(!GITLEAKS_INSTALLED && !IN_CI, SKIP_NOTE);
    });

    it('blocks a staged secret in a file that .gitattributes marks -diff', () => {
      const repository = createRepository(tempDir);
      commitFile(repository, '.gitattributes', 'hidden.cfg -diff\n', 'A: attributes');
      const assignment = generatedPasswordAssignment();
      writeFileSync(path.join(repository.root, 'hidden.cfg'), assignment.line);
      git(repository, 'add', '--', 'hidden.cfg');
      copyScriptsInto(repository.root, ACCEPTED_FINGERPRINTS);
      const run = runHook(
        path.join(repository.root, 'scripts', 'run-gitleaks.ts'),
        repository.root,
        repository.environment,
      );
      // The value must not show in any output; only then is the output safe to print.
      expect(`${run.stdout}${run.stderr}`).not.toContain(assignment.value);
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
      expect(run.stdout).toContain('medibooker-password-assignment');
      expect(run.stderr).toContain('The secret scan failed, so the commit is blocked.');
    });
  });
});

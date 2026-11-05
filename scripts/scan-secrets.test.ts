/**
 * Proves scripts/scan-secrets.ts as CI runs it. The usage, pin and clone cases need no gitleaks.
 * The cases that run the real binary skip locally without it and fail in CI, as in
 * gitleaks-config.test.ts. They scan throw-away repositories whose commits hold secrets generated
 * at run time; nothing in this repository is staged or committed, and no value is printed.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCEPTED_FINGERPRINTS,
  gitleaksEnvironment,
  historyScanArguments,
} from './lib/gitleaks.ts';
import { SHALLOW_CLONE_MESSAGE, UNKNOWN_DEPTH_MESSAGE } from './lib/shallow-clone.ts';
import {
  cloneRepository,
  commitFile,
  commitRemoval,
  copyScriptsInto,
  createRepository,
  environmentWithoutGitVariables,
  environmentWithoutTools,
  generatedLowEntropyValue,
  generatedPasswordAssignment,
  git,
  type GitRepository,
  THIRD_ENTRY,
} from './test-support/scan-fixtures.ts';

const SCRIPT = path.join(import.meta.dirname, 'scan-secrets.ts');
const USAGE_LINE = 'Usage: node scripts/scan-secrets.ts <mode> [--sarif <file>]';
const RULE_ID = 'medibooker-password-assignment';
const LOGGED_ERROR =
  'gitleaks logged an error above but exited 0, so the scan may have missed commits.';

/** Locally the gitleaks cases skip without gitleaks; in CI they fail, so they always run there. */
const IN_CI = process.env.CI === 'true';
const GITLEAKS_INSTALLED = spawnSync('gitleaks', ['version']).error === undefined;
const SKIP_NOTE =
  'gitleaks is not on PATH; install it (docs/dev/getting-started.md), then run pnpm test --force. CI installs it.';

/** The event values of a push, as GitHub Actions and the security job set them. */
interface PushEvent {
  before: string;
  sha: string;
}

let tempDir = '';

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'medibooker-scan-secrets-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function runCli(script: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
}

/**
 * A new directory with a copy of the scripts beside a .gitleaksignore of the given entries; it is
 * no git repository. Returns the copied CLI, which takes that directory as its repository root.
 */
function copyScripts(entries: readonly string[]): string {
  const root = mkdtempSync(path.join(tempDir, 'copy-'));
  copyScriptsInto(root, entries);
  return path.join(root, 'scripts', 'scan-secrets.ts');
}

/** The copied CLI in the repository, which holds the pinned .gitleaksignore. */
function cliIn(repository: GitRepository): string {
  copyScriptsInto(repository.root, ACCEPTED_FINGERPRINTS);
  return path.join(repository.root, 'scripts', 'scan-secrets.ts');
}

/** The repository's environment with the event values of a push (none for `undefined`). */
function scanEnvironment(repository: GitRepository, push?: PushEvent): NodeJS.ProcessEnv {
  return {
    ...repository.environment,
    GITHUB_EVENT_NAME: push === undefined ? '' : 'push',
    GITHUB_SHA: push?.sha ?? '',
    SCAN_BEFORE: push?.before ?? '',
    SCAN_BASE_SHA: '',
    SCAN_HEAD_SHA: '',
  };
}

describe('scripts/scan-secrets.ts', () => {
  it('pin: exits 0 on the repository', () => {
    const run = runCli(SCRIPT, ['pin']);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(
      '.gitleaksignore holds exactly the 2 fingerprints of ACCEPTED_FINGERPRINTS.\n',
    );
  });

  it.each([
    [[]],
    [['scan']],
    [['pin', '--sarif', 'gitleaks.sarif']],
    [['self-test', '--sarif', 'gitleaks.sarif']],
    [['range', '--sarif']],
    [['history', '--sarif', '-']],
    [['history', '--json', 'gitleaks.json']],
    [['range', '--sarif', 'a.sarif', '--sarif', 'b.sarif']],
  ])('prints the usage and exits 2 for %j', (args) => {
    const run = runCli(SCRIPT, args);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain(USAGE_LINE);
  });

  it.each(['pin', 'range', 'history'])(
    '%s: fails with the pin message, before any scan, when .gitleaksignore has a third entry',
    (mode) => {
      const script = copyScripts([...ACCEPTED_FINGERPRINTS, THIRD_ENTRY]);
      // Without gitleaks and git on PATH: the pin needs neither.
      const run = runCli(script, [mode], environmentWithoutTools(process.env, tempDir));
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('.gitleaksignore does not match ACCEPTED_FINGERPRINTS');
      expect(run.stderr).toContain(`Unexpected entries:\n  line 4: ${THIRD_ENTRY}`);
      expect(run.stdout).not.toContain('Secret scan of');
    },
  );

  it.each(['range', 'history'])(
    '%s: fails before any scan when git cannot tell whether the clone is shallow',
    (mode) => {
      const script = copyScripts(ACCEPTED_FINGERPRINTS);
      // The copy is no git repository; git must not find one above it, or through GIT_DIR.
      const run = runCli(script, [mode], {
        ...environmentWithoutGitVariables(process.env),
        GIT_CEILING_DIRECTORIES: tempDir,
      });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('fatal: not a git repository');
      expect(run.stderr).toContain(UNKNOWN_DEPTH_MESSAGE);
      expect(run.stdout).not.toContain('Secret scan of');
    },
  );

  describe('in a shallow clone', () => {
    it.each(['range', 'history'])(
      '%s: fails before any scan, because it would miss the commits the clone does not hold',
      (mode) => {
        const origin = createRepository(tempDir);
        const clean = commitFile(origin, 'readme.txt', 'clean\n', 'A: clean');
        commitFile(origin, 'probe-settings.ini', generatedPasswordAssignment().line, 'B: secret');
        const tip = commitRemoval(origin, 'probe-settings.ini', 'C: remove it');
        const shallow = cloneRepository(origin, tempDir, '--depth', '1');
        const run = runCli(
          cliIn(shallow),
          [mode],
          scanEnvironment(shallow, { before: clean, sha: tip }),
        );
        expect(run.status).toBe(1);
        expect(run.stderr).toContain(SHALLOW_CLONE_MESSAGE);
        expect(run.stdout).not.toContain('Secret scan of');
      },
    );
  });

  describe('with gitleaks', () => {
    beforeEach((context) => {
      context.skip(!GITLEAKS_INSTALLED && !IN_CI, SKIP_NOTE);
    });

    it('self-test: gitleaks reports and redacts both generated secrets, so it exits 0', () => {
      const run = runCli(SCRIPT, ['self-test']);
      // Safe to show: the self-test never prints a generated value.
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
      expect(run.stdout).toBe(
        [
          'Self-test: gitleaks reported the generated aws-access-token value, redacted.',
          'Self-test: gitleaks reported the generated medibooker-password-assignment value, redacted.',
          '',
        ].join('\n'),
      );
    });

    it('range: fails closed when git log fails, which gitleaks only logs (exit 0)', () => {
      // An empty repository: without an event, the range is HEAD, which does not exist yet.
      const empty = createRepository(tempDir);
      const run = runCli(cliIn(empty), ['range'], scanEnvironment(empty));
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(/ERR \[git\] fatal: ambiguous argument 'HEAD'/);
      expect(run.stderr).toContain(LOGGED_ERROR);
    });

    describe('a secret that one commit adds and the next one removes', () => {
      let repository: GitRepository;
      let script = '';
      let secret = '';
      const commits = { clean: '', secret: '', removal: '' };

      beforeAll(() => {
        repository = createRepository(tempDir);
        const assignment = generatedPasswordAssignment();
        secret = assignment.value;
        commits.clean = commitFile(repository, 'readme.txt', 'clean\n', 'A: clean');
        commits.secret = commitFile(repository, 'probe-settings.ini', assignment.line, 'B: secret');
        commits.removal = commitRemoval(repository, 'probe-settings.ini', 'C: remove it');
        script = cliIn(repository);
      });

      function scan(args: string[], push?: PushEvent) {
        const run = runCli(script, args, scanEnvironment(repository, push));
        // The value must not show in any output; only then is the output safe to print.
        expect(`${run.stdout}${run.stderr}`).not.toContain(secret);
        return run;
      }

      it('range: a push of the three commits reports it, redacted', () => {
        const run = scan(['range'], { before: commits.clean, sha: commits.removal });
        expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
        expect(run.stdout).toContain(`Secret scan of ${commits.clean}..${commits.removal}`);
        expect(run.stdout).toContain(RULE_ID);
      });

      it('range: a push of the removal alone has nothing to report', () => {
        const run = scan(['range'], { before: commits.secret, sha: commits.removal });
        expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
        expect(run.stdout).toContain(`Secret scan of ${commits.secret}..${commits.removal}`);
      });

      it('range: a previous commit that the clone does not hold scans the full history', () => {
        const run = scan(['range'], { before: 'f'.repeat(40), sha: commits.removal });
        expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
        expect(run.stdout).toContain('the full history of');
        expect(run.stdout).toContain(RULE_ID);
      });

      it('history: reports it, also in a SARIF report that does not show the value', () => {
        const sarif = path.join(repository.root, 'history.sarif');
        const run = scan(['history', '--sarif', sarif]);
        expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
        const report = readFileSync(sarif, 'utf8');
        expect(report).not.toContain(secret);
        const { runs } = JSON.parse(report) as { runs: { results: { ruleId: string }[] }[] };
        const ruleIds = runs.flatMap((sarifRun) => sarifRun.results.map((result) => result.ruleId));
        expect(ruleIds).toContain(RULE_ID);
      });
    });

    it('range and history: report a secret that only a merge commit adds', () => {
      const repository = createRepository(tempDir);
      const assignment = generatedPasswordAssignment();
      const clean = commitFile(repository, 'readme.txt', 'clean\n', 'A: clean');
      git(repository, 'switch', '--quiet', '--create', 'feature');
      commitFile(repository, 'feature.txt', 'feature\n', 'B: feature');
      git(repository, 'switch', '--quiet', 'main');
      commitFile(repository, 'main.txt', 'main\n', 'C: main');
      git(repository, 'merge', '--quiet', '--no-ff', '--no-commit', 'feature');
      // The secret is in neither parent: the merge alone adds it, as a conflict resolution can.
      writeFileSync(path.join(repository.root, 'merged-settings.ini'), assignment.line);
      git(repository, 'add', '--', 'merged-settings.ini');
      git(repository, 'commit', '--quiet', '--message', 'Merge feature');
      const merge = git(repository, 'rev-parse', 'HEAD');
      const script = cliIn(repository);
      for (const [args, push] of [
        [['range'], { before: clean, sha: merge }],
        [['history'], undefined],
      ] as const) {
        const run = runCli(script, [...args], scanEnvironment(repository, push));
        expect(`${run.stdout}${run.stderr}`).not.toContain(assignment.value);
        expect(run.status, `${args[0]}: ${run.stdout}${run.stderr}`).toBe(1);
        expect(run.stdout).toContain('merged-settings.ini');
      }
    });

    it('range and history: report a secret in a file that .gitattributes marks -diff', () => {
      const repository = createRepository(tempDir);
      const assignment = generatedPasswordAssignment();
      const clean = commitFile(repository, '.gitattributes', 'hidden.cfg -diff\n', 'A: attributes');
      const secretCommit = commitFile(repository, 'hidden.cfg', assignment.line, 'B: secret');
      const script = cliIn(repository);
      for (const [args, push] of [
        [['range'], { before: clean, sha: secretCommit }],
        [['history'], undefined],
      ] as const) {
        const run = runCli(script, [...args], scanEnvironment(repository, push));
        expect(`${run.stdout}${run.stderr}`).not.toContain(assignment.value);
        expect(run.status, `${args[0]}: ${run.stdout}${run.stderr}`).toBe(1);
        expect(run.stdout).toContain('hidden.cfg');
      }
    });

    it('history: the pinned fingerprints name their commit, so the same file, rule and line in a new commit is reported', () => {
      // The file, rule and line of an accepted fingerprint, in a new commit (08 F02 acceptance).
      const repository = createRepository(tempDir);
      const value = generatedLowEntropyValue();
      const fillers = Array.from({ length: 7 }, (_, index) => `// filler ${String(index + 1)}`);
      // Assembled at run time, so this file holds no assignment that the rule reports.
      const assignment = `  ${['password:', `'${value}'`].join(' ')},`;
      const file = 'MediBooker-ApI/config/dbConfig.js';
      commitFile(repository, file, `${[...fillers, assignment].join('\n')}\n`, 'A: re-created');
      const run = runCli(cliIn(repository), ['history'], scanEnvironment(repository));
      expect(`${run.stdout}${run.stderr}`).not.toContain(value);
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
      expect(run.stdout).toContain(
        `Fingerprint: ${git(repository, 'rev-parse', 'HEAD')}:${file}:${RULE_ID}:8`,
      );

      // A commit-less entry for that file, rule and line would silence it in every commit; the
      // pin rejects such an entry, so gitleaks runs directly here.
      writeFileSync(path.join(repository.root, '.gitleaksignore'), `${file}:${RULE_ID}:8\n`);
      const unpinned = spawnSync('gitleaks', historyScanArguments(repository.root), {
        cwd: repository.root,
        env: gitleaksEnvironment(repository.environment),
        encoding: 'utf8',
      });
      expect(`${unpinned.stdout}${unpinned.stderr}`).not.toContain(value);
      expect(unpinned.status, `${unpinned.stdout}${unpinned.stderr}`).toBe(0);
    });
  });
});

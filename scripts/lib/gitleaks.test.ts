import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCEPTED_FINGERPRINTS,
  checkIgnoreFile,
  FULL_HISTORY_REVISIONS,
  gitleaksEnvironment,
  historyScanArguments,
  ignoreEntries,
  LOG_DIFF_OPTIONS,
  NOTHING_STAGED_NOTE,
  pinMismatch,
  policyArguments,
  rangeScanArguments,
  SCAN_FAILED_HINT,
  SCAN_INSTALL_HINT,
  STAGED_FINDING_HINT,
  STAGED_INSTALL_HINT,
  stagedScanArguments,
  startFailure,
  stdinScanArguments,
  toRepositoryScanOutcome,
  toScanOutcome,
  type GitleaksRun,
  type StagedCheckRun,
} from './gitleaks.ts';

const REPOSITORY = path.resolve(import.meta.dirname, '..', '..');
const SYNTHETIC_ROOT = path.join('synthetic', 'repo root');

/** `git diff --cached --quiet` exits 1 when something is staged and 0 when nothing is. */
const SOMETHING_STAGED: StagedCheckRun = { status: 1 };
const NOTHING_STAGED: StagedCheckRun = { status: 0 };

/** A gitleaks run that exited with the given code and logged the given lines. */
function exited(status: number, stderr = ''): GitleaksRun {
  return { status, signal: null, stderr };
}

/** What gitleaks 8.30.1 logs when `git log` fails; it still exits 0. */
const LOGGED_GIT_ERROR = [
  '7:34AM ERR [git] fatal: Invalid revision range 1111111..HEAD',
  '7:34AM ERR error="stderr is not empty"',
  '7:34AM INF 0 commits scanned.',
  '7:34AM INF no leaks found',
].join('\n');

function spawnError(code: string): Error {
  return Object.assign(new Error(`spawnSync gitleaks ${code}`), { code });
}

/** The value that follows an option, as gitleaks reads it. */
function optionValue(args: readonly string[], option: string): string | undefined {
  return args.includes(option) ? args[args.indexOf(option) + 1] : undefined;
}

const [DB_CONFIG_FINGERPRINT = '', DEV_ENV_FINGERPRINT = ''] = ACCEPTED_FINGERPRINTS;

/** Go trims U+00A0 and U+0085 from a line; JavaScript's trim() keeps U+0085 and removes U+FEFF. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);
const NEXT_LINE = String.fromCharCode(0x85);
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** A .gitleaksignore text of the given entries under a comment, with LF line ends. */
function ignoreFile(...entries: string[]): string {
  return ['# Accepted findings (2026-11-04, U1).', ...entries, ''].join('\n');
}

describe('ACCEPTED_FINGERPRINTS', () => {
  it('holds the two commit-qualified fingerprints of the v1 credential in commit 0011060', () => {
    expect(ACCEPTED_FINGERPRINTS).toHaveLength(2);
    for (const fingerprint of ACCEPTED_FINGERPRINTS) {
      expect(fingerprint).toMatch(
        /^001106047c044bbb4a21394a90a66023ce013c1a:MediBooker-ApI\/[\w/.]+:medibooker-password-assignment:\d+$/,
      );
    }
  });
});

describe('.gitleaksignore pin', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'medibooker-gitleaksignore-'));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /** checkIgnoreFile on a repository root whose .gitleaksignore holds the given bytes or text. */
  function checkFile(content: string | Uint8Array): string | undefined {
    const root = mkdtempSync(path.join(tempDir, 'root-'));
    writeFileSync(path.join(root, '.gitleaksignore'), content);
    return checkIgnoreFile(root);
  }

  it('passes the committed .gitleaksignore', () => {
    expect(checkIgnoreFile(REPOSITORY)).toBeUndefined();
  });

  it('skips comments, blank lines and surrounding whitespace, as gitleaks does', () => {
    const text = [
      '# a comment',
      '',
      '   ',
      '\t# a comment after a tab',
      `  ${DB_CONFIG_FINGERPRINT}\t`,
      `${NO_BREAK_SPACE}${DEV_ENV_FINGERPRINT}${NEXT_LINE}\r`,
      '',
    ].join('\n');
    expect(ignoreEntries(text)).toEqual([
      { line: 5, text: DB_CONFIG_FINGERPRINT },
      { line: 6, text: DEV_ENV_FINGERPRINT },
    ]);
    expect(checkFile(text)).toBeUndefined();
  });

  it('reads a # after other text as part of an entry, as gitleaks does', () => {
    const entries = ignoreEntries(`${DB_CONFIG_FINGERPRINT} # accepted\n${DEV_ENV_FINGERPRINT}\n`);
    expect(entries.map((entry) => entry.text)).toEqual([
      `${DB_CONFIG_FINGERPRINT} # accepted`,
      DEV_ENV_FINGERPRINT,
    ]);
    expect(pinMismatch(entries)).toContain('Unexpected entries:');
  });

  it('fails on a third entry', () => {
    const third =
      '0123456789abcdef0123456789abcdef01234567:apps/api/.env.example:generic-api-key:3';
    const message = checkFile(ignoreFile(...ACCEPTED_FINGERPRINTS, third));
    expect(message).toContain('does not match ACCEPTED_FINGERPRINTS');
    expect(message).toContain(`Unexpected entries:\n  line 4: ${third}`);
    expect(message).not.toContain('Missing entries:');
  });

  it('fails on a commit-less entry, which would silence the finding in every commit', () => {
    const commitLess = DB_CONFIG_FINGERPRINT.replace(/^[0-9a-f]{40}:/, '');
    const message = checkFile(ignoreFile(commitLess, DEV_ENV_FINGERPRINT));
    expect(message).toContain(`Unexpected entries:\n  line 2: ${commitLess}`);
    expect(message).toContain(`Missing entries:\n  ${DB_CONFIG_FINGERPRINT}`);
  });

  it('fails on a changed fingerprint', () => {
    const changed = DB_CONFIG_FINGERPRINT.replace(/:8$/, ':9');
    const message = checkFile(ignoreFile(changed, DEV_ENV_FINGERPRINT));
    expect(message).toContain(`line 2: ${changed}`);
    expect(message).toContain(`Missing entries:\n  ${DB_CONFIG_FINGERPRINT}`);
  });

  it('fails on a pinned fingerprint listed twice', () => {
    const message = checkFile(ignoreFile(...ACCEPTED_FINGERPRINTS, DEV_ENV_FINGERPRINT));
    expect(message).toContain(`Listed more than once:\n  ${DEV_ENV_FINGERPRINT}`);
  });

  it('fails on a backslash in the path, although gitleaks would read it as the pinned entry', () => {
    const backslashed = DB_CONFIG_FINGERPRINT.replace('ApI/config/', 'ApI\\config\\');
    const message = checkFile(ignoreFile(backslashed, DEV_ENV_FINGERPRINT));
    expect(message).toContain(`line 2: ${backslashed}`);
    expect(message).toContain(`Missing entries:\n  ${DB_CONFIG_FINGERPRINT}`);
  });

  it('fails on a byte order mark, which gitleaks does not trim', () => {
    expect(checkFile(`${BYTE_ORDER_MARK}${ignoreFile(...ACCEPTED_FINGERPRINTS)}`)).toContain(
      'Unexpected entries:',
    );
  });

  it('fails on an empty file', () => {
    const message = checkFile('');
    expect(message).toContain(
      `Missing entries:\n  ${DB_CONFIG_FINGERPRINT}\n  ${DEV_ENV_FINGERPRINT}`,
    );
  });

  it('fails on a missing file', () => {
    const root = mkdtempSync(path.join(tempDir, 'missing-'));
    expect(checkIgnoreFile(root)).toMatch(
      /^\.gitleaksignore cannot be read as UTF-8 text \(ENOENT/,
    );
  });

  it('fails on a file that cannot be read (a directory)', () => {
    const root = mkdtempSync(path.join(tempDir, 'directory-'));
    mkdirSync(path.join(root, '.gitleaksignore'));
    expect(checkIgnoreFile(root)).toContain('.gitleaksignore cannot be read as UTF-8 text');
  });

  it('fails on a file that is not UTF-8', () => {
    const latin1 = Buffer.concat([
      Buffer.from(ignoreFile(...ACCEPTED_FINGERPRINTS)),
      Buffer.of(0xe9),
    ]);
    expect(checkFile(latin1)).toContain('.gitleaksignore cannot be read as UTF-8 text');
  });

  it('names an entry that is not a fingerprint by its line only, in case it is a secret', () => {
    const pasted = ['Synth3tic', 'Not', 'Real', '42'].join('-');
    const message = checkFile(ignoreFile(...ACCEPTED_FINGERPRINTS, pasted));
    expect(message).toContain('line 4: not a fingerprint (not shown, in case it is a secret)');
    expect(message).not.toContain(pasted);
  });

  it('points to the rule for entries', () => {
    expect(checkFile('')).toContain(
      'docs/architecture/07-docker-ci-cd.md §4 and\ndocs/adr/0009-ci-branch-model-and-supply-chain.md',
    );
  });
});

describe('policyArguments', () => {
  const args = policyArguments(SYNTHETIC_ROOT);

  it("reads the repository's .gitleaks.toml", () => {
    expect(optionValue(args, '--config')).toBe(path.join(SYNTHETIC_ROOT, '.gitleaks.toml'));
  });

  it('masks secrets in all output', () => {
    expect(args).toContain('--redact');
  });

  it('ignores inline gitleaks:allow comments, so a comment cannot allow a finding', () => {
    expect(args).toContain('--ignore-gitleaks-allow');
  });

  it('logs without colours, so that logged errors can be found', () => {
    expect(args).toContain('--no-color');
  });
});

describe('stagedScanArguments', () => {
  const args = stagedScanArguments(SYNTHETIC_ROOT);

  it('scans only the staged changes of the repository (gitleaks git --pre-commit --staged)', () => {
    expect(args.slice(0, 3)).toEqual(['git', '--pre-commit', '--staged']);
    expect(args.at(-1)).toBe(SYNTHETIC_ROOT);
  });

  it('uses the repository policy: its .gitleaks.toml, --redact and --ignore-gitleaks-allow', () => {
    expect(args).toEqual(expect.arrayContaining(policyArguments(SYNTHETIC_ROOT)));
  });
});

describe('the arguments of the repository scans and the self-test', () => {
  const SARIF = { format: 'sarif', path: path.join('reports', 'gitleaks.sarif') } as const;
  const scans = {
    range: (report?: typeof SARIF) => rangeScanArguments(SYNTHETIC_ROOT, 'abc..def', report),
    history: (report?: typeof SARIF) => historyScanArguments(SYNTHETIC_ROOT, report),
    stdin: (report?: typeof SARIF) => stdinScanArguments(SYNTHETIC_ROOT, report),
  };

  it.each(Object.entries(scans))(
    '%s: the policy, exit code 1 on a finding and each finding printed (redacted)',
    (_name, scan) => {
      const args = scan();
      expect(args).toEqual(expect.arrayContaining(policyArguments(SYNTHETIC_ROOT)));
      expect(optionValue(args, '--exit-code')).toBe('1');
      expect(args).toContain('--verbose');
    },
  );

  it.each(Object.entries(scans))('%s: writes a SARIF report only when asked', (_name, scan) => {
    expect(scan()).not.toContain('--report-format');
    expect(scan()).not.toContain('--report-path');
    const args = scan(SARIF);
    expect(optionValue(args, '--report-format')).toBe('sarif');
    expect(optionValue(args, '--report-path')).toBe(SARIF.path);
  });

  it('range: scans `git log <revisions>` of the repository, merges and -diff files included', () => {
    const args = scans.range();
    expect(args.slice(0, 2)).toEqual(['git', '--log-opts']);
    expect(args[2]).toBe('abc..def --diff-merges=first-parent --text');
    expect(args.at(-1)).toBe(SYNTHETIC_ROOT);
  });

  it("history: scans gitleaks' own full history (every ref), merges and -diff files included", () => {
    const args = scans.history();
    expect(args.slice(0, 2)).toEqual(['git', '--log-opts']);
    expect(args[2]).toBe(
      '--full-history --all --diff-filter=tuxdb --diff-merges=first-parent --text',
    );
    expect(args.at(-1)).toBe(SYNTHETIC_ROOT);
  });

  it('diffs a merge against its first parent and every file as text', () => {
    expect(LOG_DIFF_OPTIONS).toEqual(['--diff-merges=first-parent', '--text']);
    expect(FULL_HISTORY_REVISIONS).toEqual(['--full-history', '--all', '--diff-filter=tuxdb']);
  });

  it('passes options that gitleaks can split at spaces, with no quoted element', () => {
    // gitleaks rejects a --log-opts element that is wrapped in quotes.
    for (const options of [scans.range()[2], scans.history()[2]]) {
      expect(options?.split(' ').every((element) => /^[^'"\s]+$/.test(element))).toBe(true);
    }
  });

  it.each([
    ['range', scans.range()],
    ['history', scans.history()],
  ])('%s: reads .gitleaksignore of the repository only, and looks up no remote', (_name, args) => {
    expect(optionValue(args, '--gitleaks-ignore-path')).toBe(SYNTHETIC_ROOT);
    expect(optionValue(args, '--platform')).toBe('none');
  });

  it('stdin: reads standard input', () => {
    expect(scans.stdin()[0]).toBe('stdin');
  });
});

describe('toScanOutcome', () => {
  it('passes a clean scan of staged changes (exit 0) without a message', () => {
    expect(toScanOutcome(exited(0), SOMETHING_STAGED)).toEqual({ exitCode: 0 });
  });

  it('passes a clean scan of an empty index with a note that it checked nothing', () => {
    expect(toScanOutcome(exited(0), NOTHING_STAGED)).toEqual({
      exitCode: 0,
      message: NOTHING_STAGED_NOTE,
    });
  });

  it('adds no note when the staged check itself failed', () => {
    const failedCheck: StagedCheckRun = { error: spawnError('ENOENT'), status: null };
    expect(toScanOutcome(exited(0), failedCheck)).toEqual({ exitCode: 0 });
    expect(toScanOutcome(exited(0), { status: 128 })).toEqual({ exitCode: 0 });
  });

  it('blocks the commit when gitleaks reports a finding (exit 1)', () => {
    expect(toScanOutcome(exited(1), SOMETHING_STAGED)).toEqual({
      exitCode: 1,
      message: STAGED_FINDING_HINT,
    });
  });

  it('keeps any other non-zero exit code of gitleaks', () => {
    expect(toScanOutcome(exited(126), SOMETHING_STAGED).exitCode).toBe(126);
  });

  it('blocks the commit when gitleaks logs an error but exits 0 (a failed git diff)', () => {
    const outcome = toScanOutcome(exited(0, LOGGED_GIT_ERROR), NOTHING_STAGED);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toBe(
      'gitleaks logged an error above but exited 0, so the scan may have missed commits. The commit is blocked.',
    );
  });

  it('passes a clean scan that logged information and warnings only', () => {
    const log = '7:34AM INF 1 commits scanned.\n7:34AM WRN an ERR in a message is no error\n';
    expect(toScanOutcome(exited(0, log), SOMETHING_STAGED)).toEqual({ exitCode: 0 });
  });

  it('fails closed with the install hint when the gitleaks binary is missing (ENOENT)', () => {
    const missing = { error: spawnError('ENOENT'), status: null, signal: null, stderr: '' };
    expect(toScanOutcome(missing, SOMETHING_STAGED)).toEqual({
      exitCode: 1,
      message: STAGED_INSTALL_HINT,
    });
    expect(toScanOutcome(missing, NOTHING_STAGED)).toEqual({
      exitCode: 1,
      message: STAGED_INSTALL_HINT,
    });
  });

  it('names an install route for Windows, macOS and Linux in the install hint', () => {
    expect(STAGED_INSTALL_HINT).toMatch(
      /Windows: .*release zip.*SHA-256.*scoop install.*choco install/s,
    );
    expect(STAGED_INSTALL_HINT).toContain('macOS:   brew install gitleaks');
    expect(STAGED_INSTALL_HINT).toMatch(/Linux: .*release binary/);
  });

  // A version in a hint would go stale with the first gitleaks pull request of Renovate.
  it.each([
    ['STAGED_INSTALL_HINT', STAGED_INSTALL_HINT],
    ['SCAN_INSTALL_HINT', SCAN_INSTALL_HINT],
  ])(
    '%s points to the install routes and the pinned version, and names no version',
    (_name, hint) => {
      expect(hint).toContain('docs/dev/getting-started.md');
      expect(hint).toContain('.github/actions/gitleaks/action.yml');
      expect(hint).not.toMatch(/\d+\.\d+\.\d+/);
    },
  );

  it('fails closed when gitleaks cannot start for another reason', () => {
    const outcome = toScanOutcome(
      { error: spawnError('EACCES'), status: null, signal: null, stderr: '' },
      SOMETHING_STAGED,
    );
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toContain('spawnSync gitleaks EACCES');
  });

  it('fails closed when gitleaks is stopped by a signal', () => {
    expect(
      toScanOutcome({ status: null, signal: 'SIGTERM', stderr: '' }, SOMETHING_STAGED),
    ).toEqual({
      exitCode: 1,
      message: 'gitleaks was stopped by SIGTERM. The commit is blocked.',
    });
  });
});

describe('toRepositoryScanOutcome', () => {
  it('passes a clean scan (exit 0) without a message', () => {
    expect(toRepositoryScanOutcome(exited(0, '7:34AM INF no leaks found\n'))).toEqual({
      exitCode: 0,
    });
  });

  it('fails with gitleaks exit code when it reports a finding', () => {
    expect(toRepositoryScanOutcome(exited(1))).toEqual({ exitCode: 1, message: SCAN_FAILED_HINT });
  });

  it('fails closed when gitleaks logs an error but exits 0 (a failed git log)', () => {
    expect(toRepositoryScanOutcome(exited(0, LOGGED_GIT_ERROR))).toEqual({
      exitCode: 1,
      message:
        'gitleaks logged an error above but exited 0, so the scan may have missed commits. The secret scan failed.',
    });
  });

  it('fails closed when gitleaks is missing, cannot start or is stopped by a signal', () => {
    const missing = { error: spawnError('ENOENT'), status: null, signal: null, stderr: '' };
    expect(toRepositoryScanOutcome(missing)).toEqual({ exitCode: 1, message: SCAN_INSTALL_HINT });
    const denied = { error: spawnError('EACCES'), status: null, signal: null, stderr: '' };
    expect(toRepositoryScanOutcome(denied).exitCode).toBe(1);
    expect(toRepositoryScanOutcome({ status: null, signal: 'SIGKILL', stderr: '' })).toEqual({
      exitCode: 1,
      message: 'gitleaks was stopped by SIGKILL. The secret scan failed.',
    });
  });
});

describe('startFailure', () => {
  const messages = { missingBinary: 'install it', consequence: 'It failed.' };

  it('finds nothing wrong with a run that has an exit code', () => {
    expect(startFailure({ status: 1, signal: null }, messages)).toBeUndefined();
  });

  it('names a missing binary, a start error and a signal', () => {
    expect(
      startFailure({ error: spawnError('ENOENT'), status: null, signal: null }, messages),
    ).toBe('install it');
    expect(
      startFailure({ error: spawnError('EACCES'), status: null, signal: null }, messages),
    ).toBe('gitleaks could not start (spawnSync gitleaks EACCES). It failed.');
    expect(startFailure({ status: null, signal: null }, messages)).toBe(
      'gitleaks was stopped by a signal. It failed.',
    );
  });
});

describe('gitleaksEnvironment', () => {
  it('names the empty tree as the attribute source and keeps every other variable', () => {
    // git then reads no .gitattributes of the repository: -diff cannot hide a staged file.
    expect(gitleaksEnvironment({ PATH: 'bin', GIT_ATTR_SOURCE: 'HEAD' })).toEqual({
      PATH: 'bin',
      GIT_ATTR_SOURCE: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    });
  });
});

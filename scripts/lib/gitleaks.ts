/**
 * The gitleaks policy of this repository: the options of every scan, the pinned .gitleaksignore,
 * the arguments of the staged scan and the repository scans, how gitleaks runs, and how a run
 * becomes an exit code. Every scan fails closed. The self-test lives in secret-self-test.ts.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface ScanOutcome {
  exitCode: number;
  message?: string;
}

/**
 * The fields of a spawnSync result that decide the outcome, with what gitleaks logged to stderr.
 * Node sets no stderr when gitleaks did not start; the outcome reads it only after a start.
 */
export type GitleaksRun = Pick<SpawnSyncReturns<string>, 'error' | 'status' | 'signal' | 'stderr'>;

/** The result of `git diff --cached --quiet`: exit 0 means that nothing is staged. */
export type StagedCheckRun = Pick<SpawnSyncReturns<unknown>, 'error' | 'status'>;

/** Where the install routes and the version that CI pins are written down. */
const INSTALL_SOURCES =
  'docs/dev/getting-started.md; CI pins the version in .github/actions/gitleaks/action.yml';

export const STAGED_INSTALL_HINT = [
  'gitleaks is not installed or not on PATH, so the secret scan cannot run. The commit is blocked.',
  `Install gitleaks and open a new terminal (${INSTALL_SOURCES}):`,
  '  Windows: the release zip from https://github.com/gitleaks/gitleaks/releases, after checking',
  '           its SHA-256 against the checksums file; or scoop install gitleaks; or choco install gitleaks',
  '  macOS:   brew install gitleaks',
  '  Linux:   the release binary from https://github.com/gitleaks/gitleaks/releases, after checking',
  '           its SHA-256 against the checksums file',
].join('\n');

export const STAGED_FINDING_HINT = [
  'The secret scan failed, so the commit is blocked. gitleaks printed the reason above.',
  'Remove the secret from the staged changes and load it from the environment instead.',
  'A secret that was ever committed or pushed must be rotated; deleting it is not enough.',
  'Placeholders such as changeme, <...> or ${VAR} are allowed (docs/dev/getting-started.md).',
].join('\n');

export const NOTHING_STAGED_NOTE =
  'Nothing is staged, so the secret scan checked nothing. Stage your changes, then run pnpm verify again.';

/** A missing gitleaks in a mode of scripts/scan-secrets.ts. */
export const SCAN_INSTALL_HINT = [
  'gitleaks is not installed or not on PATH, so the secret scan cannot run. It fails.',
  `Install gitleaks (${INSTALL_SOURCES}). CI installs it before the scan.`,
].join('\n');

export const SCAN_FAILED_HINT = [
  'The secret scan failed: gitleaks found a secret or could not scan (its output above says which).',
  'Rotate a found secret first: deleting it from the history is not enough.',
  'Never add a live secret to .gitleaksignore (docs/architecture/07-docker-ci-cd.md §4).',
].join('\n');

/**
 * Options of every gitleaks scan in this repository: its .gitleaks.toml, secrets masked in all
 * output, and inline `gitleaks:allow` comments ignored, so that only a reviewed change to
 * .gitleaks.toml or .gitleaksignore can silence a finding. gitleaks reads .gitleaksignore from the
 * scan root whatever --gitleaks-ignore-path says, so every scan that reads it first checks it
 * against ACCEPTED_FINGERPRINTS (checkIgnoreFile). The log has no colours, so that the outcome can
 * find the errors that gitleaks logs without failing (ERROR_LOG_LINE).
 */
export function policyArguments(repoRoot: string): string[] {
  return [
    '--config',
    path.join(repoRoot, '.gitleaks.toml'),
    '--redact',
    '--ignore-gitleaks-allow',
    '--no-banner',
    '--no-color',
  ];
}

// --- The pinned .gitleaksignore ---------------------------------------------------------------

export const IGNORE_FILE = '.gitleaksignore';

/**
 * The only entries that .gitleaksignore may hold: the commit-qualified fingerprints of the two
 * findings of the v1 database credential in commit 0011060. The user declined to rotate it and
 * accepted the risk (U1, 2026-11-04). A change to this list follows the rule in .gitleaksignore
 * and needs the security-reviewer's approval.
 */
export const ACCEPTED_FINGERPRINTS: readonly string[] = [
  '001106047c044bbb4a21394a90a66023ce013c1a:MediBooker-ApI/config/dbConfig.js:medibooker-password-assignment:8',
  '001106047c044bbb4a21394a90a66023ce013c1a:MediBooker-ApI/dev.env:medibooker-password-assignment:5',
];

const PIN_RULE = [
  'The rule for entries is in docs/architecture/07-docker-ci-cd.md §4 and',
  'docs/adr/0009-ci-branch-model-and-supply-chain.md: never a live secret; rotate a finding first,',
  'then add its commit-qualified fingerprint (commit:file:rule:line) with a dated comment and the',
  'same change to ACCEPTED_FINGERPRINTS, in a commit that the security-reviewer approves.',
].join('\n');

/** A line of .gitleaksignore that gitleaks reads as an entry, and its line number. */
export interface IgnoreEntry {
  line: number;
  text: string;
}

/**
 * The characters that Go's strings.TrimSpace removes (unicode.IsSpace), which gitleaks applies to
 * every line. JavaScript's trim() differs: it also removes U+FEFF and keeps U+0085.
 */
const GO_SPACE =
  '[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const SURROUNDING_GO_SPACE = new RegExp(`^${GO_SPACE}+|${GO_SPACE}+$`, 'g');

/** commit:file:rule:line or file:rule:line. Any other entry is named by its line number only. */
const FINGERPRINT_SHAPE = /^(?:[0-9a-f]{40}:|[0-9a-f]{64}:)?[^:]+:[^:\s]+:\d+$/;

/**
 * The entries of a .gitleaksignore text, read the way gitleaks 8.30.1 reads them: a line ends at
 * \n, it is trimmed, and an empty line or one that starts with # is skipped; every other line is
 * an entry. gitleaks also turns \ into / in the path part of an entry. The pin compares the text
 * as written, so an entry with a backslash never equals a pinned one.
 */
export function ignoreEntries(text: string): IgnoreEntry[] {
  return text.split('\n').flatMap((rawLine, index) => {
    const line = rawLine.replace(SURROUNDING_GO_SPACE, '');
    return line === '' || line.startsWith('#') ? [] : [{ line: index + 1, text: line }];
  });
}

/**
 * Why the entries differ from ACCEPTED_FINGERPRINTS, or undefined when they hold each pinned
 * fingerprint exactly once, byte for byte, and nothing else. An unexpected entry that does not
 * look like a fingerprint, such as a pasted secret, is named by its line number only.
 */
export function pinMismatch(entries: readonly IgnoreEntry[]): string | undefined {
  const texts = entries.map((entry) => entry.text);
  const unexpected = entries.filter((entry) => !ACCEPTED_FINGERPRINTS.includes(entry.text));
  const repeated = ACCEPTED_FINGERPRINTS.filter(
    (fingerprint) => texts.filter((text) => text === fingerprint).length > 1,
  );
  const missing = ACCEPTED_FINGERPRINTS.filter((fingerprint) => !texts.includes(fingerprint));
  if (unexpected.length === 0 && repeated.length === 0 && missing.length === 0) {
    return undefined;
  }
  return [
    `${IGNORE_FILE} does not match ACCEPTED_FINGERPRINTS in scripts/lib/gitleaks.ts, so the secret scan fails.`,
    ...listing('Unexpected entries:', unexpected.map(describeEntry)),
    ...listing('Listed more than once:', repeated),
    ...listing('Missing entries:', missing),
    PIN_RULE,
  ].join('\n');
}

/**
 * Why <repoRoot>/.gitleaksignore fails the pin, or undefined when it passes. gitleaks reads that
 * file in every scan of the repository, so a missing, unreadable or non-UTF-8 file fails too.
 */
export function checkIgnoreFile(repoRoot: string): string | undefined {
  let text: string;
  try {
    // fatal: invalid UTF-8 fails. ignoreBOM: a byte order mark stays in the first line, as in
    // gitleaks, where it makes that line an entry.
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    text = decoder.decode(readFileSync(path.join(repoRoot, IGNORE_FILE)));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [
      `${IGNORE_FILE} cannot be read as UTF-8 text (${reason}), so the secret scan fails.`,
      'It must hold exactly the fingerprints of ACCEPTED_FINGERPRINTS in scripts/lib/gitleaks.ts.',
    ].join('\n');
  }
  return pinMismatch(ignoreEntries(text));
}

function listing(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : [title, ...lines.map((line) => `  ${line}`)];
}

function describeEntry(entry: IgnoreEntry): string {
  const where = `line ${String(entry.line)}`;
  return FINGERPRINT_SHAPE.test(entry.text)
    ? `${where}: ${entry.text}`
    : `${where}: not a fingerprint (not shown, in case it is a secret)`;
}

// --- Scan arguments ---------------------------------------------------------------------------

/** A report that a scan writes in addition to its console output. */
export interface ReportFile {
  format: 'json' | 'sarif';
  path: string;
}

/**
 * The revisions of gitleaks' own full-history scan: every ref, no history simplification, and no
 * deleted files. Any --log-opts replaces gitleaks' default, so the history scan names them itself.
 */
export const FULL_HISTORY_REVISIONS: readonly string[] = [
  '--full-history',
  '--all',
  '--diff-filter=tuxdb',
];

/**
 * The `git log -p` options of the repository scans, after their revisions:
 * - `--diff-merges=first-parent` shows a merge commit's changes against its first parent. Without
 *   it, `git log -p` prints no diff for a merge, so a secret that only a merge adds (a conflict
 *   resolution, a merge made in GitHub's web editor) would pass.
 * - `--text` diffs every file as text, also one that .gitattributes marks `-diff` or `binary`,
 *   which `git log -p` would print as "Binary files differ" only.
 */
export const LOG_DIFF_OPTIONS: readonly string[] = ['--diff-merges=first-parent', '--text'];

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
 * gitleaks over the commits of `git log <revisions>` (scripts/lib/scan-range.ts). gitleaks splits
 * --log-opts at spaces; the revisions are object names or a range of them, without spaces.
 */
export function rangeScanArguments(
  repoRoot: string,
  revisions: string,
  report?: ReportFile,
): string[] {
  return [
    'git',
    '--log-opts',
    [revisions, ...LOG_DIFF_OPTIONS].join(' '),
    ...findingArguments(repoRoot, report),
    ...repositoryArguments(repoRoot),
  ];
}

/** gitleaks over the full history: every branch and tag of the clone. */
export function historyScanArguments(repoRoot: string, report?: ReportFile): string[] {
  return [
    'git',
    '--log-opts',
    [...FULL_HISTORY_REVISIONS, ...LOG_DIFF_OPTIONS].join(' '),
    ...findingArguments(repoRoot, report),
    ...repositoryArguments(repoRoot),
  ];
}

/**
 * gitleaks over its standard input, for the self-test. Run it in an empty working directory:
 * gitleaks then finds no .gitleaksignore to read.
 */
export function stdinScanArguments(repoRoot: string, report?: ReportFile): string[] {
  return ['stdin', ...findingArguments(repoRoot, report)];
}

/**
 * The policy, exit code 1 on a finding, every finding printed (redacted, so a CI log names its
 * file, line and rule), and a report file only when one is asked for.
 */
function findingArguments(repoRoot: string, report: ReportFile | undefined): string[] {
  const reportArguments =
    report === undefined ? [] : ['--report-format', report.format, '--report-path', report.path];
  return [...policyArguments(repoRoot), '--exit-code', '1', '--verbose', ...reportArguments];
}

/**
 * The repository as the scan root and as the only place of .gitleaksignore, from any directory.
 * `--platform none` skips the lookup of the remote for links in findings, which logs an error
 * for a remote URL that gitleaks cannot parse.
 */
function repositoryArguments(repoRoot: string): string[] {
  return ['--platform', 'none', '--gitleaks-ignore-path', repoRoot, repoRoot];
}

// --- Running gitleaks -------------------------------------------------------------------------

/** The empty tree of a SHA-1 repository, such as this one. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * The environment of every gitleaks run: the given one, with GIT_ATTR_SOURCE set to the empty
 * tree. git (2.40 or later) then reads no .gitattributes of the repository, so a `-diff` or
 * `binary` attribute cannot turn a file's changes into "Binary files differ" in the staged scan,
 * whose git options gitleaks fixes. An older git ignores the variable.
 */
export function gitleaksEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...environment, GIT_ATTR_SOURCE: EMPTY_TREE };
}

/**
 * Runs gitleaks in the repository root with the given arguments. Each finding goes to stdout as
 * gitleaks prints it (redacted); its log (stderr) is shown after the run and kept in the result,
 * where the outcome looks for errors that gitleaks logs without failing.
 */
export function runGitleaks(repoRoot: string, args: readonly string[]): GitleaksRun {
  const run = spawnSync('gitleaks', args, {
    cwd: repoRoot,
    env: gitleaksEnvironment(process.env),
    stdio: ['ignore', 'inherit', 'pipe'],
    encoding: 'utf8',
  });
  if (run.error === undefined) {
    process.stderr.write(run.stderr);
  }
  return run;
}

// --- Outcomes ---------------------------------------------------------------------------------

/** What a failure says: where gitleaks is missing, what failing means, and what to do on a finding. */
export interface RunMessages {
  missingBinary: string;
  consequence: string;
  finding: string;
}

const STAGED_SCAN_MESSAGES: RunMessages = {
  missingBinary: STAGED_INSTALL_HINT,
  consequence: 'The commit is blocked.',
  finding: STAGED_FINDING_HINT,
};

const REPOSITORY_SCAN_MESSAGES: RunMessages = {
  missingBinary: SCAN_INSTALL_HINT,
  consequence: 'The secret scan failed.',
  finding: SCAN_FAILED_HINT,
};

/**
 * A line that gitleaks logs at level ERR or FTL (`<time> ERR <message>`, without colours). gitleaks
 * 8.30.1 logs a failed `git log` or `git diff`, such as an unknown revision, at ERR and still
 * exits 0 with "no leaks found", although it scanned nothing.
 */
const ERROR_LOG_LINE = /^\S+ (?:ERR|FTL) /m;

/**
 * Decides the exit code of the secret scan from the gitleaks run and from the staged check that
 * ran before it. A missing binary, a start error, a signal or a logged error blocks the commit; a
 * finding keeps gitleaks' exit code. A clean scan of an empty index says that it checked nothing.
 */
export function toScanOutcome(scan: GitleaksRun, stagedCheck: StagedCheckRun): ScanOutcome {
  const outcome = runOutcome(scan, STAGED_SCAN_MESSAGES);
  return outcome.exitCode === 0 && isNothingStaged(stagedCheck)
    ? { exitCode: 0, message: NOTHING_STAGED_NOTE }
    : outcome;
}

/**
 * The outcome of a range or history scan: a missing binary, a start error, a signal or a logged
 * error fails closed with exit code 1; any other failure keeps gitleaks' exit code.
 */
export function toRepositoryScanOutcome(scan: GitleaksRun): ScanOutcome {
  return runOutcome(scan, REPOSITORY_SCAN_MESSAGES);
}

function runOutcome(scan: GitleaksRun, messages: RunMessages): ScanOutcome {
  const failure = startFailure(scan, messages);
  if (failure !== undefined) {
    return { exitCode: 1, message: failure };
  }
  if (scan.status !== 0) {
    return { exitCode: scan.status ?? 1, message: messages.finding };
  }
  if (ERROR_LOG_LINE.test(scan.stderr)) {
    const reason =
      'gitleaks logged an error above but exited 0, so the scan may have missed commits.';
    return { exitCode: 1, message: `${reason} ${messages.consequence}` };
  }
  return { exitCode: 0 };
}

/** Why a run has no exit code (gitleaks missing, unable to start, stopped by a signal), if so. */
export function startFailure(
  run: Pick<GitleaksRun, 'error' | 'status' | 'signal'>,
  messages: Pick<RunMessages, 'missingBinary' | 'consequence'>,
): string | undefined {
  if (run.error !== undefined) {
    return isMissingBinary(run.error)
      ? messages.missingBinary
      : `gitleaks could not start (${run.error.message}). ${messages.consequence}`;
  }
  if (run.status === null) {
    const signal = run.signal ?? 'a signal';
    return `gitleaks was stopped by ${signal}. ${messages.consequence}`;
  }
  return undefined;
}

/** Only a clean exit of `git diff --cached --quiet` proves an empty index; errors prove nothing. */
function isNothingStaged(stagedCheck: StagedCheckRun): boolean {
  return stagedCheck.error === undefined && stagedCheck.status === 0;
}

function isMissingBinary(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT';
}

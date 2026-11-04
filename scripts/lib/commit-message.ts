/** Commit message rules (Conventional Commits), enforced by the commit-msg git hook. */

export const COMMIT_TYPES = [
  'feat',
  'fix',
  'refactor',
  'perf',
  'test',
  'docs',
  'build',
  'ci',
  'chore',
  'revert',
] as const;

export const MAX_HEADER_LENGTH = 72;

export type CommitMessageCheck = { ok: true } | { ok: false; reason: string };

/** `<type>(<scope>)!: <summary>`; the scope (lowercase kebab-case) and `!` are optional. */
const CONVENTIONAL_HEADER = new RegExp(
  `^(?:${COMMIT_TYPES.join('|')})(?:\\([a-z0-9-]+\\))?!?: \\S`,
);

/** Headers that git writes itself for merges, reverts and autosquash commits. */
const GIT_GENERATED_PREFIXES = ['Merge ', 'Revert "', 'fixup! ', 'squash! ', 'amend! '];

/** Git ignores everything below this line (`git commit --verbose`, `--cleanup=scissors`). */
const SCISSORS_LINE = '# ------------------------ >8 ------------------------';

/** U+FEFF, which some Windows editors write at the start of a UTF-8 file. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

export function validateCommitMessage(text: string): CommitMessageCheck {
  const lines = messageLines(text);
  const headerIndex = lines.findIndex((line) => line !== '');
  const header = lines[headerIndex]; // undefined when no line is left (index -1)
  if (header === undefined) {
    return { ok: false, reason: 'The commit message is empty.' };
  }

  const headerProblem = isGitGenerated(header) ? undefined : conventionalHeaderProblem(header);
  if (headerProblem !== undefined) {
    return { ok: false, reason: headerProblem };
  }

  const lineAfterHeader = lines[headerIndex + 1];
  if (lineAfterHeader !== undefined && lineAfterHeader !== '') {
    return {
      ok: false,
      reason: 'Leave the second line empty to separate the header from the body.',
    };
  }
  return { ok: true };
}

/**
 * The lines git keeps when it cleans up the message: without a byte order mark, comment lines,
 * the part below the scissors line and trailing whitespace.
 */
function messageLines(text: string): string[] {
  const withoutBom = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
  const lines = withoutBom.split(/\r?\n/).map((line) => line.trimEnd());
  const scissorsIndex = lines.indexOf(SCISSORS_LINE);
  const keptLines = scissorsIndex === -1 ? lines : lines.slice(0, scissorsIndex);
  return keptLines.filter((line) => !line.startsWith('#'));
}

function isGitGenerated(header: string): boolean {
  return GIT_GENERATED_PREFIXES.some((prefix) => header.startsWith(prefix));
}

function conventionalHeaderProblem(header: string): string | undefined {
  if (!CONVENTIONAL_HEADER.test(header)) {
    return `The header "${header}" does not follow <type>(<scope>)!: <summary>.`;
  }
  if (header.length > MAX_HEADER_LENGTH) {
    return `The header has ${String(header.length)} characters; the limit is ${String(MAX_HEADER_LENGTH)}.`;
  }
  if (header.endsWith('.')) {
    return 'The header must not end with a period.';
  }
  return undefined;
}

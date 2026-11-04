import { describe, expect, it } from 'vitest';
import { MAX_HEADER_LENGTH, validateCommitMessage } from './commit-message.ts';

/** A conventional header of exactly the given length. */
function headerOfLength(length: number): string {
  const prefix = 'chore(repo): ';
  return prefix + 'x'.repeat(length - prefix.length);
}

describe('validateCommitMessage rejects', () => {
  it.each([
    ['a header without a type', 'update stuff\n', 'does not follow'],
    ['an uppercase type', 'Chore: x\n', 'does not follow'],
    ['an uppercase scope', 'feat(API): x\n', 'does not follow'],
    ['an unknown type', 'style: format files\n', 'does not follow'],
    ['an empty summary', 'fix: \n', 'does not follow'],
    ['a missing space after the colon', 'fix:x\n', 'does not follow'],
    ['a header that ends with a period', 'fix: trailing.\n', 'must not end with a period'],
    ['an empty message', '\n\n', 'empty'],
    ['a message of comment lines only', '# Please enter the commit message\n#\n', 'empty'],
    ['a body without an empty second line', 'fix: x\nbody text\n', 'second line empty'],
  ])('%s', (_description, message, reasonPart) => {
    const check = validateCommitMessage(message);
    expect(check.ok).toBe(false);
    expect(check.ok ? '' : check.reason).toContain(reasonPart);
  });

  it(`a header of ${String(MAX_HEADER_LENGTH + 1)} characters`, () => {
    expect(validateCommitMessage(headerOfLength(MAX_HEADER_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'The header has 73 characters; the limit is 72.',
    });
  });

  it('the 101-character header first planned for F01', () => {
    const header =
      'chore(repo): scaffold pnpm 12 + Turborepo monorepo with shared TypeScript, ESLint and Prettier config';
    expect(header).toHaveLength(101);
    expect(validateCommitMessage(header).ok).toBe(false);
  });
});

describe('validateCommitMessage accepts', () => {
  it.each([
    ['a type and scope', 'chore(repo): add tooling\n'],
    ['a type without scope', 'ci: add workflow\n'],
    ['a breaking change marker', 'feat(api)!: drop the v0 routes\n'],
    ['a kebab-case scope with digits', 'fix(eslint-config2): handle spreads\n'],
    ['a message without a trailing newline', 'docs: explain the hooks'],
    ['the L00 commit header', 'chore(repo): remove the v1 apps\n'],
    ['the R00 commit header', 'docs: add architecture docs and record tenancy and UI decisions\n'],
    [
      'the F01 commit header',
      'chore(repo): scaffold pnpm workspace, Turborepo and shared tooling\n',
    ],
    ['a merge commit', "Merge branch 'main' into v2-planning\n"],
    ['a revert commit', 'Revert "feat(api): add slots"\n\nThis reverts commit 0123abc.\n'],
    ['a fixup commit', 'fixup! feat(api): add slots\n'],
    ['a squash commit', 'squash! feat(api): add slots\n'],
    ['an amend commit', 'amend! feat(api): add slots\n\nfeat(api): add free slots\n'],
  ])('%s', (_description, message) => {
    expect(validateCommitMessage(message)).toEqual({ ok: true });
  });

  it(`a header of exactly ${String(MAX_HEADER_LENGTH)} characters`, () => {
    expect(validateCommitMessage(headerOfLength(MAX_HEADER_LENGTH))).toEqual({ ok: true });
  });

  it('comment lines, CRLF line endings, a body and a Co-Authored-By trailer', () => {
    const message = [
      '# Please enter the commit message for your changes.',
      'feat(web): show free slots',
      '',
      'The public practice page lists the next free slots.',
      '',
      'Co-Authored-By: Synthetic Person <synthetic.person@example.invalid>',
      '# On branch v2-planning',
      '',
    ].join('\r\n');
    expect(validateCommitMessage(message)).toEqual({ ok: true });
  });

  it('a byte order mark (U+FEFF) and trailing whitespace on the header', () => {
    const byteOrderMark = String.fromCharCode(0xfeff);
    expect(validateCommitMessage(`${byteOrderMark}chore(repo): add tooling  \n`)).toEqual({
      ok: true,
    });
  });

  it('everything below the scissors line is ignored', () => {
    const message = [
      'chore(repo): add tooling',
      '# ------------------------ >8 ------------------------',
      'diff --git a/package.json b/package.json',
      '',
    ].join('\n');
    expect(validateCommitMessage(message)).toEqual({ ok: true });
  });
});

/**
 * commit-msg hook: rejects a commit whose message does not follow the commit convention.
 * Usage: node scripts/check-commit-msg.ts <commit-message-file>
 */
import { readFileSync } from 'node:fs';
import { COMMIT_TYPES, MAX_HEADER_LENGTH, validateCommitMessage } from './lib/commit-message.ts';

const EXPECTED_FORMAT = [
  `Expected header (at most ${String(MAX_HEADER_LENGTH)} characters, no period at the end):`,
  '  <type>(<scope>)!: <summary>',
  `Types: ${COMMIT_TYPES.join(', ')}. The scope (lowercase kebab-case) and ! are optional.`,
  'Leave the second line empty when a body follows.',
  'Example: chore(repo): add tooling',
  'See docs/dev/getting-started.md.',
].join('\n');

function main(messageFile: string | undefined): number {
  if (messageFile === undefined) {
    console.error('Usage: node scripts/check-commit-msg.ts <commit-message-file>');
    return 2;
  }
  const check = validateCommitMessage(readFileSync(messageFile, 'utf8'));
  if (!check.ok) {
    console.error(`Commit message rejected: ${check.reason}\n\n${EXPECTED_FORMAT}`);
    return 1;
  }
  return 0;
}

process.exitCode = main(process.argv[2]);

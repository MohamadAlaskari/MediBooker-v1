import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = path.join(import.meta.dirname, 'check-commit-msg.ts');

let tempDir = '';

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'medibooker-commit-msg-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Runs the hook script with plain Node (type stripping), the way the commit-msg hook does. */
function runHook(message: string) {
  const messageFile = path.join(tempDir, 'COMMIT_EDITMSG');
  writeFileSync(messageFile, message);
  return spawnSync(process.execPath, [SCRIPT, messageFile], { encoding: 'utf8' });
}

describe('scripts/check-commit-msg.ts', () => {
  it('exits 0 and prints nothing for "chore(repo): add tooling"', () => {
    const run = runHook('chore(repo): add tooling\n');
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
  });

  it('exits 1 for "update stuff" and explains the expected format', () => {
    const run = runHook('update stuff\n');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      'Commit message rejected: The header "update stuff" does not follow <type>(<scope>)!: <summary>.',
    );
    expect(run.stderr).toContain('Example: chore(repo): add tooling');
  });

  it('exits 2 with a usage line when no message file is given', () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('Usage: node scripts/check-commit-msg.ts <commit-message-file>');
  });
});

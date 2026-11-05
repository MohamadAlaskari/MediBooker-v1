import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyDeployFailure,
  hasRecordedDatabaseError,
  isBehind,
  lockRetryDelayMs,
  newestMigration,
} from './migrations.ts';

// What Prisma 7.10.1 printed in the F04 experiments (passwords and hosts never appear here).
const ROLLED_BACK_OUTPUT = `Applying migration \`20261105150000_fail\`
Error: ERROR: current transaction is aborted, commands ignored until end of transaction block
   0: schema_commands::commands::apply_migrations::Applying migration
           with migration_name="20261105150000_fail"`;
const BLOCKED_OUTPUT = `Error: P3009

migrate found failed migrations in the target database, new migrations will not be applied.
The \`20261105150000_fail\` migration started at 2026-11-05 14:38:19.299590 UTC failed`;
const RECORDED_LOCK_OUTPUT = `Error: P3018

A migration failed to apply. New migrations cannot be applied before the error is recovered from.

Migration name: 20261105160000_lock

Database error code: 55P03

Database error:
ERROR: canceling statement due to lock timeout`;

describe('newestMigration', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function prismaRoot(folders: readonly string[]): string {
    root = mkdtempSync(path.join(tmpdir(), 'db-migrate-test-'));
    const migrations = path.join(root, 'prisma', 'practice', 'migrations');
    mkdirSync(migrations, { recursive: true });
    writeFileSync(path.join(migrations, 'migration_lock.toml'), 'provider = "postgresql"\n');
    for (const folder of folders) mkdirSync(path.join(migrations, folder));
    return root;
  }

  it('is the newest folder: the timestamp prefix orders the names', () => {
    const dir = prismaRoot([
      '20261201000000_b',
      '20261105140000_practice_identity',
      '20261110000000_a',
    ]);
    expect(newestMigration(dir, 'practice')).toBe('20261201000000_b');
  });

  it('refuses a folder that is no migration, and a schema without migrations', () => {
    expect(() => newestMigration(prismaRoot(['20261105140000_ok', 'notes']), 'practice')).toThrow(
      expect.objectContaining({ code: 'MIGRATIONS_NOT_FOUND' }),
    );
    expect(() => newestMigration(prismaRoot([]), 'practice')).toThrow(
      expect.objectContaining({ code: 'MIGRATIONS_NOT_FOUND' }),
    );
    expect(() => newestMigration(prismaRoot(['20261105140000_ok']), 'platform')).toThrow(
      expect.objectContaining({ code: 'MIGRATIONS_NOT_FOUND' }),
    );
  });

  it("finds the API's own migrations from the default PRISMA_ROOT", async () => {
    const { DEFAULT_PRISMA_ROOT } = await import('./environment.ts');
    expect(newestMigration(DEFAULT_PRISMA_ROOT, 'practice')).toMatch(/^\d{14}_[a-z0-9_]+$/);
    expect(newestMigration(DEFAULT_PRISMA_ROOT, 'platform')).toMatch(/^\d{14}_[a-z0-9_]+$/);
  });
});

describe('isBehind', () => {
  it.each([
    [null, true],
    ['20261105140000_practice_identity', true],
    ['20261201000000_b', false],
    ['20261201000001_c', false],
  ])('%j is behind 20261201000000_b: %s', (version, expected) => {
    expect(isBehind(version, '20261201000000_b')).toBe(expected);
  });
});

describe('classifyDeployFailure', () => {
  it('recognises a migration that failed inside its own transaction', () => {
    expect(classifyDeployFailure(ROLLED_BACK_OUTPUT)).toEqual({ kind: 'rolled-back' });
  });

  it('recognises P3009, an unfinished migration of an earlier run', () => {
    expect(classifyDeployFailure(BLOCKED_OUTPUT)).toEqual({ kind: 'blocked' });
  });

  it('reads the SQLSTATE of a recorded database error (P3018), such as 55P03', () => {
    expect(classifyDeployFailure(RECORDED_LOCK_OUTPUT)).toEqual({
      kind: 'database-error',
      sqlState: '55P03',
    });
    expect(classifyDeployFailure('Error: P3018\n\nno code')).toEqual({
      kind: 'database-error',
      sqlState: undefined,
    });
  });

  it.each([
    ['P1000', 'DATABASE_AUTH_FAILED'],
    ['P1001', 'DATABASE_UNREACHABLE'],
    ['P1002', 'DATABASE_UNREACHABLE'],
    ['P1003', 'DATABASE_NOT_FOUND'],
    ['P1010', 'DATABASE_PERMISSION_DENIED'],
    ['P1011', 'DATABASE_TLS_FAILED'],
    ['P1017', 'DATABASE_UNREACHABLE'],
  ])('maps the connection error %s to %s', (prismaCode, code) => {
    expect(classifyDeployFailure(`Error: ${prismaCode}: details that are never read`)).toEqual({
      kind: 'connection',
      code,
    });
  });

  it('knows nothing else', () => {
    expect(classifyDeployFailure('Error: P4002')).toEqual({ kind: 'unknown' });
    expect(classifyDeployFailure('')).toEqual({ kind: 'unknown' });
  });
});

describe('hasRecordedDatabaseError', () => {
  it('needs a database error code in the logs', () => {
    expect(hasRecordedDatabaseError(RECORDED_LOCK_OUTPUT)).toBe(true);
    expect(hasRecordedDatabaseError(null)).toBe(false);
    expect(hasRecordedDatabaseError('connection reset')).toBe(false);
  });
});

describe('lockRetryDelayMs', () => {
  it('doubles from the base', () => {
    expect([1, 2, 3].map((attempt) => lockRetryDelayMs(attempt, 1000))).toEqual([1000, 2000, 4000]);
  });
});

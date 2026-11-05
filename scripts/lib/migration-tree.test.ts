import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkMigrationTree, formatProblem, MIGRATION_FOLDERS } from './migration-tree.ts';

const HEADER = "BEGIN;\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';\n";
const PLATFORM = 'apps/api/prisma/platform/migrations';
const PRACTICE = 'apps/api/prisma/practice/migrations';

let root = '';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'medibooker-migration-tree-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes `<folder>/<name>/migration.sql` under the temporary root. */
function writeMigration(folder: string, name: string, body: string): void {
  const directory = path.join(root, folder, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'migration.sql'), `${HEADER}${body}\nCOMMIT;\n`);
}

describe('checkMigrationTree', () => {
  it('checks the platform and the practice folder of 02 §9', () => {
    expect(MIGRATION_FOLDERS).toEqual([
      { schema: 'platform', folder: PLATFORM },
      { schema: 'practice', folder: PRACTICE },
    ]);
  });

  it('checks every migration.sql of both folders by name and reports path, line and rule', () => {
    writeMigration(PLATFORM, '20990102000000_drop', 'DROP TABLE "a";');
    writeMigration(PLATFORM, '20990101000000_create', 'CREATE TABLE "a" ("id" INT);');
    writeFileSync(path.join(root, PLATFORM, 'migration_lock.toml'), 'provider = "postgresql"\n');
    mkdirSync(path.join(root, PLATFORM, '20990103000000_without_sql'));
    writeMigration(PRACTICE, '20990101000000_grant', 'GRANT SELECT ON t TO practice_x_app;');

    const { checked, problems } = checkMigrationTree(root);

    expect(checked).toBe(3);
    expect(problems.map(({ path: file, line, rule }) => [file, line, rule])).toEqual([
      [`${PLATFORM}/20990102000000_drop/migration.sql`, 4, 'contract'],
      [`${PRACTICE}/20990101000000_grant/migration.sql`, 4, 'literal-role'],
    ]);
  });

  it('applies the literal-role rule to practice migrations only', () => {
    writeMigration(PLATFORM, '20990101000000_grant', 'GRANT SELECT ON t TO platform_app;');
    writeMigration(PRACTICE, '20990101000000_create', 'CREATE TABLE "a" ("id" INT);');
    expect(checkMigrationTree(root)).toEqual({ checked: 2, problems: [] });
  });

  it('fails a missing folder and a folder without migration.sql, so it never passes unread', () => {
    mkdirSync(path.join(root, PRACTICE, '20990101000000_without_sql'), { recursive: true });
    expect(checkMigrationTree(root)).toEqual({
      checked: 0,
      problems: [
        { path: PLATFORM, rule: 'layout', message: 'the migration folder is missing' },
        { path: PRACTICE, rule: 'layout', message: 'the folder holds no migration.sql' },
      ],
    });
  });
});

describe('formatProblem', () => {
  it('prints path:line, the rule and the reason', () => {
    const problem = { path: `${PLATFORM}/a/migration.sql`, line: 7, rule: 'contract' as const };
    expect(formatProblem({ ...problem, message: 'DROP needs a "-- contract" comment' })).toBe(
      `${PLATFORM}/a/migration.sql:7: [contract] DROP needs a "-- contract" comment`,
    );
  });

  it('prints a folder without a line', () => {
    expect(formatProblem({ path: PLATFORM, rule: 'layout', message: 'missing' })).toBe(
      `${PLATFORM}: [layout] missing`,
    );
  });
});

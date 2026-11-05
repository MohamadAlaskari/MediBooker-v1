/**
 * The command of `pnpm check:migrations`, run with plain Node as `pnpm verify` and the CI quality
 * job run it: on a copy of the script in a temporary repository with fixture migrations, and on
 * the committed migrations.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPTS_DIR = import.meta.dirname;
const SCRIPT = 'check-migrations.ts';

const HEADER = "BEGIN;\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';\n";
const PLATFORM = 'apps/api/prisma/platform/migrations';
const PRACTICE = 'apps/api/prisma/practice/migrations';

let root = '';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'medibooker-check-migrations-'));
  // The copy takes the temporary directory as its repository root.
  mkdirSync(path.join(root, 'scripts'));
  copyFileSync(path.join(SCRIPTS_DIR, SCRIPT), path.join(root, 'scripts', SCRIPT));
  cpSync(path.join(SCRIPTS_DIR, 'lib'), path.join(root, 'scripts', 'lib'), {
    recursive: true,
    filter: (source) => !source.endsWith('.test.ts'),
  });
  writeFileSync(path.join(root, 'package.json'), '{ "type": "module" }\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes `<folder>/<name>/migration.sql` and returns its path relative to the root. */
function writeMigration(folder: string, name: string, sql: string): string {
  const file = `${folder}/${name}/migration.sql`;
  mkdirSync(path.join(root, folder, name), { recursive: true });
  writeFileSync(path.join(root, file), sql);
  return file;
}

/** A migration with the header, the body lines (from line 4 on) and the final COMMIT. */
function migration(...body: string[]): string {
  return `${HEADER}${body.join('\n')}\nCOMMIT;\n`;
}

/** Runs `<scriptRoot>/scripts/check-migrations.ts`, by default the copy in the temporary root. */
function checkMigrations(scriptRoot = root, ...args: string[]) {
  const script = path.join(scriptRoot, 'scripts', SCRIPT);
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: scriptRoot });
}

describe('scripts/check-migrations.ts', () => {
  it('exits 0 for migrations that follow every rule', () => {
    writeMigration(PLATFORM, '20990101000000_registry', migration('CREATE TABLE "a" ("id" INT);'));
    writeMigration(PRACTICE, '20990101000000_identity', migration('CREATE TABLE "b" ("id" INT);'));
    const run = checkMigrations();
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe('check-migrations: 2 migrations follow the rules.\n');
    expect(run.status).toBe(0);
  });

  describe('fails (08, F04 acceptance)', () => {
    it('a migration without the transaction header', () => {
      const file = writeMigration(
        PLATFORM,
        '20990101000000_registry',
        '-- CreateTable\nCREATE TABLE "a" ("id" INT);\n',
      );
      writeMigration(PRACTICE, '20990101000000_identity', migration('SELECT 1;'));
      const run = checkMigrations();
      expect(run.stderr).toContain(
        `${file}:2: [transaction] the migration must start with BEGIN; SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '60s';`,
      );
      expect(run.stderr).toContain(`${file}:2: [transaction] the migration must end with COMMIT;`);
      expect(run.status).toBe(1);
    });

    it('a DROP without a -- contract comment', () => {
      writeMigration(PLATFORM, '20990101000000_registry', migration('SELECT 1;'));
      const file = writeMigration(
        PRACTICE,
        '20990102000000_drop_legacy',
        migration('-- AlterTable', 'ALTER TABLE "practice_identity" DROP COLUMN "legacy";'),
      );
      const run = checkMigrations();
      expect(run.stderr).toContain(`${file}:5: [contract] DROP needs a "-- contract" comment`);
      expect(run.status).toBe(1);
    });

    it('a grant that names a role literally in a practice migration', () => {
      writeMigration(PLATFORM, '20990101000000_registry', migration('SELECT 1;'));
      const file = writeMigration(
        PRACTICE,
        '20990102000000_grant',
        migration('GRANT SELECT ON practice_identity TO practice_0a1b2c3d_app;'),
      );
      const run = checkMigrations();
      expect(run.stderr).toContain(
        `${file}:4: [literal-role] GRANT in a practice migration names its role only as EXECUTE format('GRANT … ON … TO %I', app_role())`,
      );
      expect(run.status).toBe(1);
    });
  });

  it('reports every rule with its file and line, and how many problems it found', () => {
    const fixtures = [
      [PLATFORM, '1_transaction', migration('COMMIT;', 'SELECT 1;'), 4, 'transaction'],
      [PLATFORM, '2_timeout', migration("SET LOCAL lock_timeout = '1min';"), 4, 'timeout'],
      [
        PLATFORM,
        '3_concurrently',
        migration('REFRESH MATERIALIZED VIEW CONCURRENTLY v;'),
        4,
        'concurrently',
      ],
      [PLATFORM, '4_contract', migration('ALTER TABLE "a" RENAME TO "b";'), 4, 'contract'],
      [PRACTICE, '1_literal_role', migration('REVOKE ALL ON t FROM PUBLIC;'), 4, 'literal-role'],
      [PRACTICE, '2_syntax', migration("SELECT 'unterminated;"), 4, 'syntax'],
    ] as const;
    for (const [folder, name, sql] of fixtures) {
      writeMigration(folder, name, sql);
    }
    const run = checkMigrations();
    const lines = run.stderr.trimEnd().split(/\r?\n/);
    expect(lines.slice(0, fixtures.length).map((line) => line.replace(/\] .*$/, ']'))).toEqual(
      fixtures.map(
        ([folder, name, , line, rule]) =>
          `${folder}/${name}/migration.sql:${String(line)}: [${rule}]`,
      ),
    );
    expect(lines.at(-1)).toBe(
      '6 migration problem(s). The rules: docs/architecture/02-api.md §9 (Authoring migrations).',
    );
    expect(run.status).toBe(1);
  });

  it('fails when a migration folder is missing', () => {
    writeMigration(PRACTICE, '20990101000000_identity', migration('SELECT 1;'));
    const run = checkMigrations();
    expect(run.stderr).toContain(`${PLATFORM}: [layout] the migration folder is missing`);
    expect(run.status).toBe(1);
  });

  it('exits 2 with a usage line when it gets an argument', () => {
    const run = checkMigrations(root, PLATFORM);
    expect(run.stderr).toBe('Usage: node scripts/check-migrations.ts\n');
    expect(run.status).toBe(2);
  });

  it('passes the committed migrations', () => {
    const run = checkMigrations(path.resolve(SCRIPTS_DIR, '..'));
    expect(run.stderr).toBe('');
    expect(run.stdout).toMatch(/^check-migrations: \d+ migrations follow the rules\.\n$/);
    expect(run.status).toBe(0);
  });
});

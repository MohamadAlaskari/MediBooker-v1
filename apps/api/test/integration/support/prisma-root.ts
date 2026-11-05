import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_PRISMA_ROOT } from '@medibooker/db-migrate';

/**
 * A temporary PRISMA_ROOT (02 §6) for fixture migrations: a copy of the practice schema, its
 * migrations and its Prisma config, to which a test adds migrations that never reach the
 * repository. Its node_modules links to the API's, so the config resolves `prisma/config`.
 */
export interface FixturePrismaRoot {
  readonly path: string;
  /** Adds `prisma/practice/migrations/<name>/migration.sql`. */
  addPracticeMigration(name: string, sql: string): void;
  /** Removes the link first, then the directory: nothing of the API's node_modules is touched. */
  dispose(): void;
}

export function createFixturePrismaRoot(): FixturePrismaRoot {
  const root = mkdtempSync(path.join(tmpdir(), 'medibooker-prisma-root-'));
  const link = path.join(root, 'node_modules');
  const config = 'prisma.practice.config.ts';
  const schema = path.join('prisma', 'practice');
  cpSync(path.join(DEFAULT_PRISMA_ROOT, config), path.join(root, config));
  cpSync(path.join(DEFAULT_PRISMA_ROOT, schema), path.join(root, schema), { recursive: true });
  // A junction on Windows needs no privilege; elsewhere the type is ignored (a symlink).
  symlinkSync(path.join(DEFAULT_PRISMA_ROOT, 'node_modules'), link, 'junction');
  return {
    path: root,
    addPracticeMigration(name, sql) {
      const folder = path.join(root, 'prisma', 'practice', 'migrations', name);
      mkdirSync(folder);
      writeFileSync(path.join(folder, 'migration.sql'), sql);
    },
    dispose() {
      rmSync(link, { force: true });
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** A fixture migration in the form of every real one (ADR 0005 §6.3): atomic and bounded. */
export function atomicMigration(statements: string): string {
  return [
    'BEGIN;',
    "SET LOCAL lock_timeout = '3s';",
    "SET LOCAL statement_timeout = '60s';",
    statements,
    'COMMIT;',
    '',
  ].join('\n');
}

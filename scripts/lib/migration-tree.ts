/**
 * Finds the migrations of both Prisma schemas in a repository and checks each one with the rules
 * of migration-rules.ts. A missing migration folder, or one without a migration, fails too, so
 * the check never passes because it read nothing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { checkMigrationSql, type MigrationRule, type MigrationSchema } from './migration-rules.ts';

/** The migration folders, relative to the repository root, in the order they are checked. */
export const MIGRATION_FOLDERS: readonly { schema: MigrationSchema; folder: string }[] = [
  { schema: 'platform', folder: 'apps/api/prisma/platform/migrations' },
  { schema: 'practice', folder: 'apps/api/prisma/practice/migrations' },
];

export interface MigrationProblem {
  /** The file or folder, relative to the repository root, with forward slashes. */
  path: string;
  /** The 1-based line; absent for a problem of the folder. */
  line?: number;
  rule: MigrationRule | 'layout';
  message: string;
}

export interface MigrationTreeCheck {
  /** How many migration.sql files were checked. */
  checked: number;
  problems: MigrationProblem[];
}

/** Checks every `<folder>/<migration>/migration.sql` of both schemas under the given root. */
export function checkMigrationTree(root: string): MigrationTreeCheck {
  let checked = 0;
  const problems: MigrationProblem[] = [];
  for (const { schema, folder } of MIGRATION_FOLDERS) {
    const files = migrationFiles(root, folder);
    if (files === undefined) {
      problems.push({ path: folder, rule: 'layout', message: 'the migration folder is missing' });
      continue;
    }
    if (files.length === 0) {
      problems.push({ path: folder, rule: 'layout', message: 'the folder holds no migration.sql' });
    }
    for (const file of files) {
      checked += 1;
      const sql = readFileSync(path.join(root, file), 'utf8');
      for (const { rule, line, message } of checkMigrationSql(sql, schema)) {
        problems.push({ path: file, line, rule, message });
      }
    }
  }
  return { checked, problems };
}

/** `path:line: [rule] message`, or `path: [rule] message` for a folder. */
export function formatProblem({ path: where, line, rule, message }: MigrationProblem): string {
  const location = line === undefined ? where : `${where}:${String(line)}`;
  return `${location}: [${rule}] ${message}`;
}

/**
 * The migration.sql files of a folder, sorted by migration name (the order Prisma applies them),
 * as paths relative to the root; undefined when the folder does not exist.
 */
function migrationFiles(root: string, folder: string): string[] | undefined {
  const directory = path.join(root, folder);
  if (!existsSync(directory)) {
    return undefined;
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => path.posix.join(folder, name, 'migration.sql'))
    .filter((file) => existsSync(path.join(root, file)));
}

/**
 * `pnpm check:migrations`, in `pnpm verify` and in the CI quality job: checks every migration.sql
 * of both Prisma schemas against the migration rules of ADR 0005 §6 and
 * docs/architecture/02-api.md §9 (scripts/lib/migration-rules.ts). Prints each problem as
 * `file:line: [rule] reason` and exits 1 when there is one.
 * Usage: node scripts/check-migrations.ts
 */
import path from 'node:path';
import { checkMigrationTree, formatProblem } from './lib/migration-tree.ts';

// The repository is the directory above this script; the tests run a copy in a temporary tree.
const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function main(args: readonly string[]): number {
  if (args.length > 0) {
    console.error('Usage: node scripts/check-migrations.ts');
    return 2;
  }
  const { checked, problems } = checkMigrationTree(REPO_ROOT);
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(formatProblem(problem));
    }
    console.error(
      `\n${String(problems.length)} migration problem(s). The rules: docs/architecture/02-api.md §9 (Authoring migrations).`,
    );
    return 1;
  }
  console.log(`check-migrations: ${String(checked)} migrations follow the rules.`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));

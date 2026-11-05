/**
 * Writes src/generated/schema-versions.ts (02 §9) with PLATFORM_SCHEMA_REQUIRED and
 * PRACTICE_SCHEMA_REQUIRED: the newest migration folder name of each Prisma schema when the API
 * is built. Readiness and the practice schema guard compare the databases with them (ADR 0005
 * §6.8). The timestamp prefix of a folder name makes the names comparable as strings.
 * Run by `pnpm db:generate` with Node's type stripping.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const apiRoot = path.resolve(import.meta.dirname, '..');

/** The folder names Prisma Migrate creates: a 14-digit timestamp and a snake_case name. */
const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+$/;

function newestMigration(schema: 'platform' | 'practice'): string {
  const folder = path.join(apiRoot, 'prisma', schema, 'migrations');
  const names = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const invalid = names.find((name) => !MIGRATION_NAME.test(name));
  if (invalid !== undefined) {
    throw new Error(`prisma/${schema}/migrations: unexpected folder name ${invalid}`);
  }
  const newest = names.at(-1);
  if (newest === undefined) throw new Error(`prisma/${schema}/migrations has no migration`);
  return newest;
}

const content = [
  '// Written by scripts/write-schema-versions.ts (pnpm db:generate). Do not edit.',
  `export const PLATFORM_SCHEMA_REQUIRED = '${newestMigration('platform')}';`,
  `export const PRACTICE_SCHEMA_REQUIRED = '${newestMigration('practice')}';`,
  '',
].join('\n');

const outputFolder = path.join(apiRoot, 'src', 'generated');
mkdirSync(outputFolder, { recursive: true });
writeFileSync(path.join(outputFolder, 'schema-versions.ts'), content);

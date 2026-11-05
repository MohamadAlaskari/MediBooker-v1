import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv as parseDotenv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { type EnvSource, parseEnv } from './env.schema.js';
import { findWorkspaceRoot } from './load-env.js';

/**
 * The keys of the root `.env.example` that only docker compose, medibooker-db and the Prisma CLI
 * read, never the API (02 §7). Adding one is a change to this list.
 */
const DATABASE_TOOL_KEYS = [
  'POSTGRES_PASSWORD',
  'PLATFORM_OWNER_PASSWORD',
  'PLATFORM_APP_PASSWORD',
  'PROVISIONER_PASSWORD',
  'PLATFORM_MIGRATION_URL',
  'PROVISIONER_DATABASE_URL',
  'DATABASE_ADMIN_URL',
  'PRACTICE_MIGRATION_URL',
  'SHADOW_DATABASE_URL',
  'MIGRATION_CONCURRENCY',
  'MIGRATION_TIMEOUT_MS',
  'MIGRATION_LOCK_RETRIES',
  'PRACTICE_APP_CONNECTION_LIMIT',
  'PRACTICE_OWNER_CONNECTION_LIMIT',
];

/**
 * The root `.env.example` is what every developer copies to `.env` (02 §7), so it must parse and
 * list exactly the API's variables and the database tools' keys. apps/api/turbo.json makes the
 * file an input of this test.
 */
function readEnvExample(): EnvSource {
  const root = findWorkspaceRoot(import.meta.dirname);
  if (root === undefined) throw new Error('no workspace root above the API');
  return parseDotenv(readFileSync(path.join(root, '.env.example'), 'utf8'));
}

describe('the root .env.example', () => {
  it('parses into a valid local environment', () => {
    expect(parseEnv(readEnvExample())).toMatchObject({ APP_ENV: 'local', HOST: '127.0.0.1' });
  });

  it('lists exactly the variables of the API and the keys of the database tools', () => {
    const variables = readEnvExample();
    expect(Object.keys(variables).sort()).toEqual(
      [...Object.keys(parseEnv(variables)), ...DATABASE_TOOL_KEYS].sort(),
    );
  });
});

import { childEnv } from '../../support/child-env.js';

/**
 * The variables of the database tools (the root .env.example, 02 §7), and Prisma's engine
 * logging, which a developer's shell may hold.
 */
const TOOL_VARIABLES = [
  'APP_ENV',
  'PLATFORM_DATABASE_URL',
  'PLATFORM_MIGRATION_URL',
  'PRACTICE_MIGRATION_URL',
  'SHADOW_DATABASE_URL',
  'PROVISIONER_DATABASE_URL',
  'DATABASE_ADMIN_URL',
  'DATABASE_CLUSTER_ENDPOINTS',
  'SECRET_STORE',
  'DEV_SECRET_SEED',
  'MARKETS',
  'MIGRATION_CONCURRENCY',
  'MIGRATION_TIMEOUT_MS',
  'MIGRATION_LOCK_RETRIES',
  'PRACTICE_APP_CONNECTION_LIMIT',
  'PRACTICE_OWNER_CONNECTION_LIMIT',
  'PRISMA_ROOT',
  'POSTGRES_PASSWORD',
  'PLATFORM_OWNER_PASSWORD',
  'PLATFORM_APP_PASSWORD',
  'PROVISIONER_PASSWORD',
  'RUST_LOG',
  'RUST_BACKTRACE',
];

/**
 * The environment of a medibooker-db or Prisma CLI run: the test's own variables and nothing
 * else of the database tools. NODE_ENV=production keeps a developer's root .env out of
 * medibooker-db and the Prisma configs (02 §9). A variable is left out, never set blank: Prisma
 * 7.10.1 rejects a blank SHADOW_DATABASE_URL (P1013) for every command.
 */
export function toolEnv(variables: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const inherited = Object.entries(childEnv()).filter(([name]) => !TOOL_VARIABLES.includes(name));
  return {
    ...Object.fromEntries(inherited),
    NODE_ENV: 'production',
    CHECKPOINT_DISABLE: '1',
    ...variables,
  };
}

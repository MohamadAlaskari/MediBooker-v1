/**
 * `@medibooker/db-migrate`: the lifecycle commands of medibooker-db as functions with explicit
 * options (the CLI in cli.ts only parses argv and the environment), createPracticeDatabase(),
 * the SecretStore port with the development store, and what the seed and the integration
 * harness share with them. Test helpers are in `@medibooker/db-migrate/testing`.
 */
export { migrate, type MigrateOptions } from './commands/migrate.ts';
export {
  practiceCreate,
  type PracticeCreateOptions,
  type PracticeCreateResult,
} from './commands/practice-create.ts';
export { provision, type ProvisionOptions, type ProvisionResult } from './commands/provision.ts';
export { reconcileRoles, type ReconcileRolesOptions } from './commands/roles-reconcile.ts';
export { resetLocal, type ResetLocalOptions } from './commands/reset-local.ts';
export { isExactPracticeAcl, verify, type VerifyOptions } from './commands/verify.ts';
export { APP_ENVS, isLocalOrCi, type AppEnv } from './lib/app-env.ts';
export type { ClusterEndpoints, Endpoint } from './lib/cluster.ts';
export { localActor, type ExitCode } from './lib/command.ts';
export {
  DEFAULT_CONNECTION_LIMITS,
  DEFAULT_MIGRATION_CONCURRENCY,
  DEFAULT_MIGRATION_LOCK_RETRIES,
  DEFAULT_MIGRATION_TIMEOUT_MS,
  DEFAULT_PRISMA_ROOT,
  parseToolEnvironment,
  type EnvironmentResult,
  type ToolEnvironment,
} from './lib/environment.ts';
export { ERROR_CODES, toErrorCode, ToolError, type ErrorCode } from './lib/errors.ts';
export { newestMigration } from './lib/migrations.ts';
export { practiceNames, type PracticeNames } from './lib/names.ts';
export {
  jsonLineSink,
  silentOutput,
  type OutputLine,
  type OutputSink,
  type PracticeLine,
  type SummaryLine,
} from './lib/output.ts';
export {
  createPracticeDatabase,
  type CreatePracticeDatabaseOptions,
  type PracticeDatabaseNames,
} from './lib/practice-database.ts';
export type { ConnectionLimits } from './lib/roles.ts';
export { scramSha256Verifier } from './lib/scram.ts';
export {
  createDevSecretStore,
  deriveDevSecret,
  type DevSecretStoreOptions,
  type SecretStore,
} from './lib/secret-store.ts';

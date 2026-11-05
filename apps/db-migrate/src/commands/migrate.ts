import type { Client } from 'pg';
import { mapWithConcurrency } from '../lib/concurrency.ts';
import {
  clusterAccessResolver,
  createCaFiles,
  type CaFiles,
  type ClusterAccess,
} from '../lib/cluster.ts';
import {
  requireSecretStore,
  runAudited,
  type ExitCode,
  type PracticeCommandOptions,
} from '../lib/command.ts';
import { connect, urlConnectionConfig } from '../lib/database.ts';
import {
  DEFAULT_LOCK_RETRY_BASE_MS,
  deployWithRecovery,
  practiceDeployTarget,
  readSchemaVersion,
  urlDeployTarget,
  type DeploySettings,
} from '../lib/deploy.ts';
import { toErrorCode, ToolError, type ErrorCode } from '../lib/errors.ts';
import { isBehind, newestMigration } from '../lib/migrations.ts';
import { practiceNames } from '../lib/names.ts';
import { elapsedMs, practiceLine, type OutputSink } from '../lib/output.ts';
import {
  listClusters,
  listPractices,
  MIGRATED_STATUSES,
  recordDeployOutcome,
  type PracticeRecord,
} from '../lib/registry.ts';
import type { SecretStore } from '../lib/secret-store.ts';

export interface MigrateOptions extends PracticeCommandOptions {
  readonly target: 'platform' | 'practices' | 'all';
  /** `migrate practices --practice <id>`: only this practice. */
  readonly practiceId: string | undefined;
  /** MIGRATION_CONCURRENCY. */
  readonly concurrency: number;
  /** MIGRATION_TIMEOUT_MS, per Prisma process. */
  readonly timeoutMs: number;
  /** MIGRATION_LOCK_RETRIES. */
  readonly lockRetries: number;
  readonly lockRetryBaseMs?: number;
}

/**
 * The runner's advisory lock key ('medb'): one session-level lock on a dedicated platform
 * connection keeps two runners from working on one deployment at once (ADR 0005 §6.2). It
 * differs from the key Prisma locks each migrated database with.
 */
const RUNNER_LOCK_KEY = 0x6d_65_64_62;

function deploySettings(options: MigrateOptions): DeploySettings {
  return {
    prismaRoot: options.prismaRoot,
    timeoutMs: options.timeoutMs,
    lockRetries: options.lockRetries,
    lockRetryBaseMs: options.lockRetryBaseMs ?? DEFAULT_LOCK_RETRY_BASE_MS,
  };
}

/** `migrate platform`: `prisma migrate deploy` with the platform config, as platform_owner. */
async function migratePlatform(options: MigrateOptions): Promise<ErrorCode | null> {
  const start = performance.now();
  let from: string | null = null;
  let to: string | null = null;
  const errorCode = await runAudited(
    options,
    { action: 'medibooker-db.migrate.platform', practiceId: null },
    async () => {
      from = await readSchemaVersion(urlConnectionConfig(options.platformUrl));
      const outcome = await deployWithRecovery(
        urlDeployTarget(options.platformUrl, 'platform'),
        deploySettings(options),
      );
      to = outcome.schemaVersion;
      return outcome.errorCode;
    },
    // The first platform migration creates the audit table: before it, no STARTED row.
    { allowMissingTable: true },
  );
  options.output.write({
    command: 'migrate platform',
    practices: 0,
    failed: 0,
    durationMs: elapsedMs(start),
    errorCode,
    from,
    to,
  });
  return errorCode;
}

type PracticeRun =
  | { readonly practice: PracticeRecord; readonly ownerPassword: string; readonly errorCode: null }
  | {
      readonly practice: PracticeRecord;
      readonly ownerPassword: undefined;
      readonly errorCode: ErrorCode;
    };

/**
 * Resolves every selected practice's owner secret before any statement runs on its database
 * (02 §6). A practice whose reference cannot be resolved fails on its own; the others run.
 */
async function resolveOwnerSecrets(
  practices: readonly PracticeRecord[],
  store: SecretStore,
): Promise<PracticeRun[]> {
  const runs: PracticeRun[] = [];
  for (const practice of practices) {
    try {
      if (practice.ownerSecretRef === null) throw new ToolError('SECRET_UNRESOLVABLE');
      runs.push({
        practice,
        ownerPassword: await store.get(practice.ownerSecretRef),
        errorCode: null,
      });
    } catch (error) {
      runs.push({ practice, ownerPassword: undefined, errorCode: toErrorCode(error) });
    }
  }
  return runs;
}

interface PracticeMigrationContext {
  readonly options: MigrateOptions;
  readonly platform: Client;
  readonly accessOf: (clusterId: string | null) => Promise<ClusterAccess>;
  readonly caFiles: CaFiles;
}

/** Migrates one practice as its owner and records the outcome; never throws. */
async function migratePractice(
  context: PracticeMigrationContext,
  run: PracticeRun,
): Promise<ErrorCode | null> {
  const start = performance.now();
  const { practice } = run;
  let to: string | null = null;
  let errorCode: ErrorCode | null = run.errorCode;
  if (run.errorCode === null) {
    try {
      if (practice.databaseName === null) throw new ToolError('CLUSTER_NOT_FOUND');
      const access = await context.accessOf(practice.clusterId);
      const owner = {
        user: practiceNames(practice.id).ownerRole,
        password: run.ownerPassword,
        database: practice.databaseName,
      };
      const target = practiceDeployTarget(access, owner, await context.caFiles.pathFor(access));
      const outcome = await deployWithRecovery(target, deploySettings(context.options));
      to = outcome.schemaVersion;
      errorCode = outcome.errorCode;
    } catch (error) {
      errorCode = toErrorCode(error);
    }
  }
  try {
    await recordDeployOutcome(context.platform, practice.id, to, errorCode);
  } catch (error) {
    errorCode ??= toErrorCode(error);
  }
  context.options.output.write(
    practiceLine(practice.id, practice.schemaVersion, to, start, errorCode),
  );
  return errorCode;
}

/**
 * `migrate practices [--practice <id>]`: the migration runner (ADR 0005 §6.2). It migrates the
 * practices in a migrated status whose schema version is behind the newest migration folder,
 * MIGRATION_CONCURRENCY at a time, records each outcome in the registry and goes on after a
 * failure. Returns the number of failed practices, or the command's own error.
 */
async function migratePractices(
  options: MigrateOptions,
): Promise<{ errorCode: ErrorCode | null; failed: number }> {
  const start = performance.now();
  let selected = 0;
  let failed = 0;
  const errorCode = await runAudited(
    options,
    { action: 'medibooker-db.migrate.practices', practiceId: options.practiceId ?? null },
    async (platform) => {
      const store = requireSecretStore(options.secretStore);
      const targetVersion = newestMigration(options.prismaRoot, 'practice');
      const practices = await listPractices(platform, MIGRATED_STATUSES, options.practiceId);
      if (options.practiceId !== undefined && practices.length === 0) {
        throw new ToolError('PRACTICE_NOT_FOUND');
      }
      const behind = practices.filter((practice) =>
        isBehind(practice.schemaVersion, targetVersion),
      );
      selected = behind.length;
      const runs = await resolveOwnerSecrets(behind, store);
      const accessOf = clusterAccessResolver(await listClusters(platform), {
        appEnv: options.appEnv,
        endpoints: options.clusterEndpoints,
        secretStore: store,
      });
      const caFiles = createCaFiles();
      try {
        const context: PracticeMigrationContext = { options, platform, accessOf, caFiles };
        const results = await mapWithConcurrency(runs, options.concurrency, (run) =>
          migratePractice(context, run),
        );
        failed = results.filter((result) => result !== null).length;
      } finally {
        await caFiles.dispose();
      }
      return null;
    },
  );
  writeSummary(options.output, 'migrate practices', selected, failed, start, errorCode);
  return { errorCode, failed };
}

function writeSummary(
  output: OutputSink,
  command: string,
  practices: number,
  failed: number,
  start: number,
  errorCode: ErrorCode | null,
): void {
  output.write({ command, practices, failed, durationMs: elapsedMs(start), errorCode });
}

/** Takes the runner lock on its own platform connection; undefined when another runner holds it. */
async function lockRunner(platformUrl: string): Promise<Client | undefined> {
  const client = await connect(urlConnectionConfig(platformUrl));
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [RUNNER_LOCK_KEY],
    );
    locked = result.rows[0]?.locked === true;
    return locked ? client : undefined;
  } finally {
    if (!locked) await client.end().catch(() => undefined);
  }
}

/**
 * `migrate platform|practices|all` (02 §6). A release runs the platform first, then the
 * practices; `all` stops after a failed platform migration. Exit code 1 when anything failed.
 */
export async function migrate(options: MigrateOptions): Promise<ExitCode> {
  const start = performance.now();
  let lock: Client | undefined;
  try {
    lock = await lockRunner(options.platformUrl);
  } catch (error) {
    writeSummary(options.output, `migrate ${options.target}`, 0, 0, start, toErrorCode(error));
    return 1;
  }
  if (lock === undefined) {
    writeSummary(options.output, `migrate ${options.target}`, 0, 0, start, 'RUNNER_BUSY');
    return 1;
  }
  try {
    if (options.target !== 'practices') {
      const platformError = await migratePlatform(options);
      if (platformError !== null) return 1;
      if (options.target === 'platform') return 0;
    }
    const result = await migratePractices(options);
    return result.errorCode === null && result.failed === 0 ? 0 : 1;
  } finally {
    // Ending the session releases the advisory lock.
    await lock.end().catch(() => undefined);
  }
}

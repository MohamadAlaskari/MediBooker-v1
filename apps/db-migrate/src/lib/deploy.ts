import { setTimeout as sleep } from 'node:timers/promises';
import type { Client, ClientConfig } from 'pg';
import {
  pgConnectionConfig,
  prismaDatasourceUrl,
  type ClusterAccess,
  type Credentials,
} from './cluster.ts';
import {
  connect,
  deriveUrl,
  TOOL_APPLICATION_NAME,
  urlConnectionConfig,
  withConnection,
} from './database.ts';
import { toErrorCode, type ErrorCode } from './errors.ts';
import {
  classifyDeployFailure,
  hasRecordedDatabaseError,
  lockRetryDelayMs,
  type SchemaName,
} from './migrations.ts';
import { runPrisma, type PrismaRun } from './prisma-cli.ts';

/** The application name of Prisma's connections, by which a timeout finds them (02 §6). */
export const MIGRATE_APPLICATION_NAME = 'medibooker-migrate';

const CONFIG_FILES: Readonly<Record<SchemaName, string>> = {
  platform: 'prisma.platform.config.ts',
  practice: 'prisma.practice.config.ts',
};

const DATASOURCE_VARIABLES: Readonly<Record<SchemaName, string>> = {
  platform: 'PLATFORM_MIGRATION_URL',
  practice: 'PRACTICE_MIGRATION_URL',
};

/** How often the runner looks for a migration that waits on a lock. */
const LOCK_WATCH_INTERVAL_MS = 250;

/** The first wait before a lock retry; each further retry waits twice as long. */
export const DEFAULT_LOCK_RETRY_BASE_MS = 1000;

/** One database that `prisma migrate deploy` brings to the newest migration. */
export interface DeployTarget {
  /** pg options of the migrating role (owner) on the database: lock watch, termination, reads. */
  readonly connection: ClientConfig;
  /** The Prisma config under PRISMA_ROOT, for example `prisma.practice.config.ts`. */
  readonly configFile: string;
  /** The variable the config reads, with a URL that carries `application_name=medibooker-migrate`. */
  readonly datasourceEnv: Readonly<Record<string, string>>;
}

/** A practice database on its cluster, migrated as the practice's owner role (02 §6). */
export function practiceDeployTarget(
  access: ClusterAccess,
  owner: Credentials,
  caFile: string | undefined,
): DeployTarget {
  const url = prismaDatasourceUrl(access, owner, {
    applicationName: MIGRATE_APPLICATION_NAME,
    caFile,
  });
  return {
    connection: pgConnectionConfig(access, owner, TOOL_APPLICATION_NAME),
    configFile: CONFIG_FILES.practice,
    datasourceEnv: { [DATASOURCE_VARIABLES.practice]: url },
  };
}

/**
 * A database given by a URL: the platform database as platform_owner (PLATFORM_MIGRATION_URL),
 * or a template database as the local superuser.
 */
export function urlDeployTarget(url: string, schema: SchemaName): DeployTarget {
  return {
    connection: urlConnectionConfig(url),
    configFile: CONFIG_FILES[schema],
    datasourceEnv: {
      [DATASOURCE_VARIABLES[schema]]: deriveUrl(url, { applicationName: MIGRATE_APPLICATION_NAME }),
    },
  };
}

export interface DeploySettings {
  readonly prismaRoot: string;
  /** MIGRATION_TIMEOUT_MS, per Prisma process. */
  readonly timeoutMs: number;
  /** MIGRATION_LOCK_RETRIES. */
  readonly lockRetries: number;
  /** The first wait before a lock retry; each further retry waits twice as long. */
  readonly lockRetryBaseMs: number;
}

export interface DeployOutcome {
  readonly errorCode: ErrorCode | null;
  /** The newest finished, not rolled-back migration afterwards; null when unreadable. */
  readonly schemaVersion: string | null;
}

const LOCK_WAIT_QUERY = `SELECT EXISTS (
  SELECT 1 FROM pg_stat_activity
  WHERE datname = current_database() AND application_name = $1 AND wait_event_type = 'Lock'
) AS waiting`;

const TERMINATE_QUERY = `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = current_database() AND application_name = $1 AND pid <> pg_backend_pid()`;

/**
 * Watches the database while Prisma migrates it: Prisma 7 does not report the error of a
 * migration that failed inside its own transaction (see DeployFailure), so the runner observes
 * a lock wait itself. A migration that fails with lock_not_available has waited `lock_timeout`
 * (3 s) first, which a poll every 250 ms cannot miss. Best effort: a watch that cannot connect
 * observes nothing.
 */
function watchLockWaits(config: ClientConfig): { stop: () => Promise<boolean> } {
  const stopping = new AbortController();
  let observed = false;
  const watching = (async () => {
    let client: Client | undefined;
    try {
      client = await connect(config);
      while (!stopping.signal.aborted) {
        const result = await client.query<{ waiting: boolean }>(LOCK_WAIT_QUERY, [
          MIGRATE_APPLICATION_NAME,
        ]);
        if (result.rows[0]?.waiting === true) observed = true;
        await sleep(LOCK_WATCH_INTERVAL_MS, undefined, { signal: stopping.signal });
      }
    } catch {
      // Stopped while waiting, or the watch failed: what it observed so far stands.
    } finally {
      await client?.end().catch(() => undefined);
    }
  })();
  return {
    stop: async () => {
      stopping.abort();
      await watching;
      return observed;
    },
  };
}

/** Ends Prisma's backends on the database when the timeout fires (MIGRATION_TIMEOUT). */
async function terminateMigrationBackends(config: ClientConfig): Promise<void> {
  await withConnection(config, (client) =>
    client.query(TERMINATE_QUERY, [MIGRATE_APPLICATION_NAME]),
  );
}

async function deployOnce(
  target: DeployTarget,
  settings: DeploySettings,
): Promise<{ run: PrismaRun; lockWaitObserved: boolean }> {
  const watch = watchLockWaits(target.connection);
  const run = await runPrisma({
    args: ['migrate', 'deploy', '--config', target.configFile],
    cwd: settings.prismaRoot,
    env: target.datasourceEnv,
    timeoutMs: settings.timeoutMs,
    onTimeout: () => terminateMigrationBackends(target.connection),
  });
  return { run, lockWaitObserved: await watch.stop() };
}

/** The unfinished, not rolled-back entry of `_prisma_migrations`, if there is one. */
async function readUnfinishedMigration(
  target: DeployTarget,
): Promise<{ name: string; logs: string | null } | undefined> {
  return withConnection(target.connection, async (client) => {
    const result = await client.query<{ migration_name: string; logs: string | null }>(
      `SELECT migration_name, logs FROM _prisma_migrations
       WHERE finished_at IS NULL AND rolled_back_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { name: row.migration_name, logs: row.logs };
  });
}

/** The newest finished, not rolled-back migration; null before the first one. */
export async function readSchemaVersion(connection: ClientConfig): Promise<string | null> {
  return withConnection(connection, async (client) => {
    const table = await client.query<{ found: boolean }>(
      "SELECT to_regclass('_prisma_migrations') IS NOT NULL AS found",
    );
    if (table.rows[0]?.found !== true) return null;
    const result = await client.query<{ migration_name: string }>(
      `SELECT migration_name FROM _prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
       ORDER BY migration_name DESC LIMIT 1`,
    );
    return result.rows[0]?.migration_name ?? null;
  });
}

/** `migrate resolve --rolled-back <name>`: null when it worked, otherwise an error code. */
async function markRolledBack(
  target: DeployTarget,
  settings: DeploySettings,
  migrationName: string,
): Promise<ErrorCode | null> {
  const run = await runPrisma({
    args: ['migrate', 'resolve', '--rolled-back', migrationName, '--config', target.configFile],
    cwd: settings.prismaRoot,
    env: target.datasourceEnv,
    timeoutMs: settings.timeoutMs,
  });
  if (run.exitCode === 0) return null;
  if (run.timedOut) return 'MIGRATION_TIMEOUT';
  const failure = classifyDeployFailure(run.output);
  return failure.kind === 'connection' ? failure.code : 'PRISMA_CLI_FAILED';
}

/**
 * Deploys until the database is current or a failure is final (ADR 0005 §6.4):
 *
 * - a migration that failed inside its own transaction was rolled back, so the runner marks it
 *   rolled back at once; when it had waited on a lock (lock_not_available), it deploys again
 *   after an exponential backoff, at most `lockRetries` times;
 * - P3009 (an unfinished entry of an earlier run): with an error the database reported in its
 *   logs, `migrate resolve --rolled-back` and a second deploy in the same run; without one (a
 *   lost connection, a timeout) the state is unknown and the runbook decides with `verify`;
 * - on timeout, Prisma's backends are terminated (MIGRATION_TIMEOUT).
 */
async function deployUntilSettled(
  target: DeployTarget,
  settings: DeploySettings,
): Promise<ErrorCode | null> {
  let lockRetries = 0;
  let unblocked = false;
  for (;;) {
    const { run, lockWaitObserved } = await deployOnce(target, settings);
    if (run.timedOut) return 'MIGRATION_TIMEOUT';
    if (run.exitCode === 0) return null;
    if (run.exitCode === null) return 'PRISMA_CLI_FAILED';
    const failure = classifyDeployFailure(run.output);
    switch (failure.kind) {
      case 'blocked': {
        const entry = await readUnfinishedMigration(target);
        if (unblocked || entry === undefined || !hasRecordedDatabaseError(entry.logs)) {
          return 'MIGRATION_STATE_UNKNOWN';
        }
        const resolveError = await markRolledBack(target, settings, entry.name);
        if (resolveError !== null) return resolveError;
        unblocked = true;
        continue;
      }
      case 'rolled-back': {
        const entry = await readUnfinishedMigration(target);
        if (entry === undefined) return 'MIGRATION_STATE_UNKNOWN';
        const resolveError = await markRolledBack(target, settings, entry.name);
        if (resolveError !== null) return resolveError;
        if (!lockWaitObserved) return 'MIGRATION_FAILED';
        if (lockRetries >= settings.lockRetries) return 'MIGRATION_LOCK_NOT_AVAILABLE';
        lockRetries += 1;
        await sleep(lockRetryDelayMs(lockRetries, settings.lockRetryBaseMs));
        continue;
      }
      case 'database-error':
        return failure.sqlState === '55P03' ? 'MIGRATION_LOCK_NOT_AVAILABLE' : 'MIGRATION_FAILED';
      case 'connection':
        return failure.code;
      case 'unknown':
        return 'MIGRATION_FAILED';
    }
  }
}

/** Deploys one database and reads the schema version it ends at, after success or failure. */
export async function deployWithRecovery(
  target: DeployTarget,
  settings: DeploySettings,
): Promise<DeployOutcome> {
  const errorCode = await deployUntilSettled(target, settings).catch(toErrorCode);
  const schemaVersion = await readSchemaVersion(target.connection).catch(() => null);
  if (errorCode === null && schemaVersion === null) {
    return { errorCode: 'MIGRATION_STATE_UNKNOWN', schemaVersion };
  }
  return { errorCode, schemaVersion };
}

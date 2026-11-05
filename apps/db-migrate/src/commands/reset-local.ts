import { isLocalOrCi } from '../lib/app-env.ts';
import { auditFinished, auditStarted, type AuditScope } from '../lib/audit.ts';
import { credentialsFromUrl } from '../lib/cluster.ts';
import type { CommandOptions, ExitCode } from '../lib/command.ts';
import { quoteIdent, urlConnectionConfig, withConnection } from '../lib/database.ts';
import { DEFAULT_LOCK_RETRY_BASE_MS, deployWithRecovery, urlDeployTarget } from '../lib/deploy.ts';
import { toErrorCode, type ErrorCode } from '../lib/errors.ts';
import { elapsedMs } from '../lib/output.ts';
import { PRACTICE_TEMPLATE } from '../lib/template.ts';

export interface ResetLocalOptions extends CommandOptions {
  /** DATABASE_ADMIN_URL: the local cluster's superuser. */
  readonly adminUrl: string;
  readonly prismaRoot: string;
  readonly migrationTimeoutMs: number;
}

/** The role that reads the platform database; 01-cluster.sh grants it CONNECT the same way. */
const PLATFORM_APP_ROLE = 'platform_app';

/** Drops every practice database, the template and the practice roles, as the superuser. */
async function dropPracticeObjects(adminUrl: string): Promise<void> {
  await withConnection(urlConnectionConfig(adminUrl), async (admin) => {
    const databases = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database
       WHERE datname ~ '^practice_[0-9a-f]{32}$' OR datname = $1 ORDER BY datname`,
      [PRACTICE_TEMPLATE],
    );
    for (const { datname } of databases.rows) {
      const database = quoteIdent(datname);
      // PostgreSQL refuses to drop a database that is still marked as a template.
      await admin.query(`ALTER DATABASE ${database} WITH IS_TEMPLATE false`);
      await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    }
    const roles = await admin.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname ~ '^practice_[0-9a-f]{32}_(app|owner)$'
       ORDER BY rolname`,
    );
    for (const { rolname } of roles.rows) await admin.query(`DROP ROLE ${quoteIdent(rolname)}`);
  });
}

/**
 * Drops the platform database and creates it again as 01-cluster.sh does: owned by the role of
 * PLATFORM_MIGRATION_URL, builtin `C.UTF-8` locale, CONNECT only for platform_app.
 */
async function recreatePlatformDatabase(adminUrl: string, platformUrl: string): Promise<void> {
  const platform = credentialsFromUrl(platformUrl);
  const database = quoteIdent(platform.database);
  await withConnection(urlConnectionConfig(adminUrl), async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.query(
      `CREATE DATABASE ${database} OWNER ${quoteIdent(platform.user)} TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'`,
    );
    await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${database} TO ${quoteIdent(PLATFORM_APP_ROLE)}`);
  });
}

/**
 * `reset-local` (02 §6), refused unless APP_ENV is local or ci: drops the practice databases,
 * practice_template and the practice roles, recreates the platform database and applies the
 * platform migrations. The reset drops the audit log it would write to, so the STARTED row goes
 * to the old platform database (when it has one) and the outcome to the new one.
 */
export async function resetLocal(options: ResetLocalOptions): Promise<ExitCode> {
  const start = performance.now();
  let errorCode: ErrorCode | null;
  if (!isLocalOrCi(options.appEnv)) {
    errorCode = 'LOCAL_ONLY';
  } else {
    const scope: AuditScope = {
      actor: options.actor,
      action: 'medibooker-db.reset-local',
      practiceId: null,
    };
    await withConnection(urlConnectionConfig(options.platformUrl), (platform) =>
      auditStarted(platform, scope, { allowMissingTable: true }),
    ).catch(() => undefined);
    try {
      await dropPracticeObjects(options.adminUrl);
      await recreatePlatformDatabase(options.adminUrl, options.platformUrl);
      const outcome = await deployWithRecovery(urlDeployTarget(options.platformUrl, 'platform'), {
        prismaRoot: options.prismaRoot,
        timeoutMs: options.migrationTimeoutMs,
        lockRetries: 0,
        lockRetryBaseMs: DEFAULT_LOCK_RETRY_BASE_MS,
      });
      errorCode = outcome.errorCode;
    } catch (error) {
      errorCode = toErrorCode(error);
    }
    const outcome = errorCode;
    const auditError = await withConnection(urlConnectionConfig(options.platformUrl), (platform) =>
      auditFinished(platform, scope, outcome),
    ).catch(() => 'AUDIT_WRITE_FAILED' as const);
    errorCode ??= auditError;
  }
  options.output.write({
    command: 'reset-local',
    practices: 0,
    failed: 0,
    durationMs: elapsedMs(start),
    errorCode,
  });
  return errorCode === null ? 0 : 1;
}

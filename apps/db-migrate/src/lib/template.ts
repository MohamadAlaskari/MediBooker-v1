import type { Client } from 'pg';
import { isLocalOrCi, type AppEnv } from './app-env.ts';
import {
  deriveUrl,
  quoteIdent,
  quoteLiteral,
  urlConnectionConfig,
  withConnection,
} from './database.ts';
import { DEFAULT_LOCK_RETRY_BASE_MS, deployWithRecovery, urlDeployTarget } from './deploy.ts';
import { ToolError } from './errors.ts';
import { newestMigration } from './migrations.ts';

/**
 * The migrated template of local and CI test copies (02 §6): `pnpm db:seed` creates it, and
 * `provisionPractice({ fromTemplate: true })` copies it through createPracticeDatabase().
 */
export const PRACTICE_TEMPLATE = 'practice_template';

/**
 * The newest migration practice_template was built with (its database comment); undefined when
 * there is no template, null when it has no comment.
 */
export async function readTemplateVersion(admin: Client): Promise<string | null | undefined> {
  const result = await admin.query<{ version: string | null }>(
    "SELECT shobj_description(oid, 'pg_database') AS version FROM pg_database WHERE datname = $1",
    [PRACTICE_TEMPLATE],
  );
  return result.rows[0]?.version;
}

export interface PracticeTemplateOptions {
  readonly appEnv: AppEnv;
  /** DATABASE_ADMIN_URL: the local cluster's superuser. */
  readonly adminUrl: string;
  readonly prismaRoot: string;
  readonly migrationTimeoutMs: number;
}

/**
 * Creates or refreshes practice_template (local and ci only): builtin `C.UTF-8`, migrated with
 * `migrate deploy` (no `medibooker.app_role`, so the migrations grant nothing), then marked as a
 * template that accepts no connections, because PostgreSQL copies a database only while no
 * session is connected to it. The newest migration is recorded as its comment last, so a run
 * that stopped halfway rebuilds it. A current template is left as it is.
 */
export async function ensurePracticeTemplate(
  options: PracticeTemplateOptions,
): Promise<{ refreshed: boolean; version: string }> {
  if (!isLocalOrCi(options.appEnv)) throw new ToolError('LOCAL_ONLY');
  const newest = newestMigration(options.prismaRoot, 'practice');
  const template = quoteIdent(PRACTICE_TEMPLATE);
  const isCurrent = await withConnection(urlConnectionConfig(options.adminUrl), async (admin) => {
    const version = await readTemplateVersion(admin);
    if (version === newest) return true;
    if (version !== undefined) {
      await admin.query(`ALTER DATABASE ${template} WITH IS_TEMPLATE false`);
      await admin.query(`DROP DATABASE ${template} WITH (FORCE)`);
    }
    await admin.query(
      `CREATE DATABASE ${template} TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'`,
    );
    return false;
  });
  if (isCurrent) return { refreshed: false, version: newest };

  const templateUrl = deriveUrl(options.adminUrl, { database: PRACTICE_TEMPLATE });
  const outcome = await deployWithRecovery(urlDeployTarget(templateUrl, 'practice'), {
    prismaRoot: options.prismaRoot,
    timeoutMs: options.migrationTimeoutMs,
    lockRetries: 0,
    lockRetryBaseMs: DEFAULT_LOCK_RETRY_BASE_MS,
  });
  if (outcome.errorCode !== null) throw new ToolError(outcome.errorCode);
  if (outcome.schemaVersion !== newest) throw new ToolError('MIGRATION_STATE_UNKNOWN');
  await withConnection(urlConnectionConfig(options.adminUrl), async (admin) => {
    await admin.query(`ALTER DATABASE ${template} WITH IS_TEMPLATE true ALLOW_CONNECTIONS false`);
    await admin.query(`COMMENT ON DATABASE ${template} IS ${quoteLiteral(newest)}`);
  });
  return { refreshed: true, version: newest };
}

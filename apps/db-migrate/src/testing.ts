/**
 * `@medibooker/db-migrate/testing`: the helpers of the seed, the API's integration harness and
 * (from P06) the web e2e fixtures, so that none of them needs raw SQL or a `pg` dependency of its
 * own (02 §6, 01 §3). Local and CI only: they use the development secret store and, for template
 * copies and teardown, the cluster superuser.
 */
import type { Client } from 'pg';
import { provision } from './commands/provision.ts';
import { isLocalOrCi, type AppEnv } from './lib/app-env.ts';
import { resolveClusterAccess, type ClusterEndpoints } from './lib/cluster.ts';
import { localActor } from './lib/command.ts';
import { deriveUrl, quoteIdent, urlConnectionConfig, withConnection } from './lib/database.ts';
import {
  DEFAULT_CONNECTION_LIMITS,
  DEFAULT_MIGRATION_LOCK_RETRIES,
  DEFAULT_MIGRATION_TIMEOUT_MS,
  DEFAULT_PRISMA_ROOT,
} from './lib/environment.ts';
import { ToolError } from './lib/errors.ts';
import { newestMigration } from './lib/migrations.ts';
import { practiceNames, type PracticeNames } from './lib/names.ts';
import { silentOutput, type OutputSink } from './lib/output.ts';
import { chooseCluster, provisionedPractice, type ProvisionedPractice } from './lib/placement.ts';
import { createPracticeDatabase, writePracticeIdentity } from './lib/practice-database.ts';
import {
  deletePractice,
  insertRoutedPractice,
  markDeprovisioning,
  readPractice,
} from './lib/registry.ts';
import { ensurePracticeRoles, type ConnectionLimits } from './lib/roles.ts';
import type { SecretStore } from './lib/secret-store.ts';
import { PRACTICE_TEMPLATE, readTemplateVersion } from './lib/template.ts';

export type { ProvisionedPractice } from './lib/placement.ts';
export {
  ensurePracticeTemplate,
  PRACTICE_TEMPLATE,
  type PracticeTemplateOptions,
} from './lib/template.ts';
export { loadWorkspaceEnv } from './lib/workspace-env.ts';

export interface ProvisionPracticeOptions {
  readonly practiceId: string;
  /** ISO 3166-1 alpha-2, for example SA or DE. */
  readonly market: string;
  /** `--cluster`; otherwise the only active cluster, or `local` registered on first use. */
  readonly clusterId?: string;
  readonly appEnv: AppEnv;
  /** PLATFORM_MIGRATION_URL: the platform database as platform_owner. */
  readonly platformUrl: string;
  /** PROVISIONER_DATABASE_URL: registers the cluster `local` when none exists. */
  readonly provisionerUrl?: string;
  /** DATABASE_ADMIN_URL: the cluster superuser; needed for `fromTemplate`. */
  readonly adminUrl?: string;
  readonly secretStore: SecretStore;
  readonly prismaRoot?: string;
  readonly clusterEndpoints?: ClusterEndpoints;
  readonly connectionLimits?: ConnectionLimits;
  readonly migrationTimeoutMs?: number;
  readonly migrationLockRetries?: number;
  readonly lockRetryBaseMs?: number;
  readonly actor?: string;
  /** Where the provisioning JSON lines go; by default nowhere. */
  readonly output?: OutputSink;
  /**
   * Copy practice_template as the superuser instead of the full path: fast fixtures for tests
   * that do not test provisioning. Copies are never migrated.
   */
  readonly fromTemplate?: boolean;
  /** Full path only: stop after the role step, as a run that crashed there would. */
  readonly stopAfter?: 'roles';
}

function requireLocal(appEnv: AppEnv): void {
  if (!isLocalOrCi(appEnv)) throw new ToolError('LOCAL_ONLY');
}

/**
 * Gives a template copy what the practice migrations give a provisioned database (02 §9): DML for
 * the app role on every table but `_prisma_migrations`, `practice_identity` read-only for it, the
 * default privileges for tables the owner creates later, and the identity row. The copied objects
 * keep the template's owner, so the practice's owner role gets every privilege on them instead,
 * which seedPracticeFixture uses.
 */
async function grantCopiedObjects(copy: Client, names: PracticeNames): Promise<void> {
  const owner = quoteIdent(names.ownerRole);
  const app = quoteIdent(names.appRole);
  const tables = await copy.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`,
  );
  await copy.query('BEGIN');
  await copy.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${owner}`);
  await copy.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${owner}`);
  for (const { tablename } of tables.rows) {
    await copy.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${quoteIdent(tablename)} TO ${app}`);
  }
  await copy.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app}`);
  await copy.query(`REVOKE INSERT, UPDATE, DELETE ON practice_identity FROM ${app}`);
  await copy.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app}`,
  );
  await copy.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${app}`,
  );
  await writePracticeIdentity(copy, names.practiceId);
  await copy.query('COMMIT');
}

async function provisionFromTemplate(
  options: ProvisionPracticeOptions,
): Promise<ProvisionedPractice> {
  const { adminUrl, secretStore } = options;
  if (adminUrl === undefined) throw new ToolError('ENVIRONMENT_INVALID');
  const names = practiceNames(options.practiceId);
  const newest = newestMigration(options.prismaRoot ?? DEFAULT_PRISMA_ROOT, 'practice');
  const passwords = {
    app: await secretStore.ensure(names.appSecretRef),
    owner: await secretStore.ensure(names.ownerSecretRef),
  };
  const cluster = await withConnection(
    urlConnectionConfig(options.platformUrl),
    async (platform) => {
      if ((await readPractice(platform, names.practiceId)) !== undefined) {
        throw new ToolError('PRACTICE_EXISTS');
      }
      return chooseCluster(platform, null, {
        appEnv: options.appEnv,
        clusterId: options.clusterId,
        provisionerUrl: options.provisionerUrl,
      });
    },
  );
  const access = await resolveClusterAccess(cluster, {
    appEnv: options.appEnv,
    endpoints: options.clusterEndpoints ?? new Map(),
    secretStore,
  });
  await withConnection(urlConnectionConfig(adminUrl), async (admin) => {
    if ((await readTemplateVersion(admin)) !== newest) {
      throw new ToolError(
        'TEMPLATE_STALE',
        'practice_template is missing or older than the newest practice migration: run pnpm db:seed',
      );
    }
    await ensurePracticeRoles(
      admin,
      names,
      passwords,
      options.connectionLimits ?? DEFAULT_CONNECTION_LIMITS,
    );
    await createPracticeDatabase(admin, names, { template: PRACTICE_TEMPLATE });
  });
  await withConnection(
    urlConnectionConfig(deriveUrl(adminUrl, { database: names.databaseName })),
    (copy) => grantCopiedObjects(copy, names),
  );
  await withConnection(urlConnectionConfig(options.platformUrl), (platform) =>
    insertRoutedPractice(platform, {
      practiceId: names.practiceId,
      market: options.market,
      clusterId: cluster.id,
      databaseName: names.databaseName,
      appSecretRef: names.appSecretRef,
      ownerSecretRef: names.ownerSecretRef,
      schemaVersion: newest,
    }),
  );
  return provisionedPractice(names, access, passwords.owner);
}

/**
 * Provisions a practice for tests and the seed: by default the full path of `medibooker-db
 * provision` as medibooker_provisioner (with its audit rows), or a copy of practice_template as
 * the superuser (`fromTemplate`), refused with "run pnpm db:seed" when the template is older
 * than the newest practice migration. Throws a ToolError with the code of a failed run.
 */
export async function provisionPractice(
  options: ProvisionPracticeOptions,
): Promise<ProvisionedPractice> {
  requireLocal(options.appEnv);
  if (options.fromTemplate === true) return provisionFromTemplate(options);
  const result = await provision({
    appEnv: options.appEnv,
    platformUrl: options.platformUrl,
    actor: options.actor ?? localActor(),
    output: options.output ?? silentOutput,
    secretStore: options.secretStore,
    prismaRoot: options.prismaRoot ?? DEFAULT_PRISMA_ROOT,
    clusterEndpoints: options.clusterEndpoints ?? new Map(),
    practiceId: options.practiceId,
    market: options.market,
    clusterId: options.clusterId,
    provisionerUrl: options.provisionerUrl,
    markets: undefined,
    connectionLimits: options.connectionLimits ?? DEFAULT_CONNECTION_LIMITS,
    migrationTimeoutMs: options.migrationTimeoutMs ?? DEFAULT_MIGRATION_TIMEOUT_MS,
    migrationLockRetries: options.migrationLockRetries ?? DEFAULT_MIGRATION_LOCK_RETRIES,
    lockRetryBaseMs: options.lockRetryBaseMs,
    stopAfter: options.stopAfter,
  });
  if (result.errorCode !== null) throw new ToolError(result.errorCode);
  if (result.practice === undefined) throw new ToolError('INTERNAL_ERROR');
  return result.practice;
}

export interface DropPracticeOptions {
  readonly practiceId: string;
  readonly appEnv: AppEnv;
  /** PLATFORM_MIGRATION_URL: the platform database as platform_owner. */
  readonly platformUrl: string;
  /** DATABASE_ADMIN_URL: the cluster superuser, which may end the app role's sessions. */
  readonly adminUrl: string;
}

/**
 * Removes a test practice (06 §3): status DEPROVISIONING first, so a running API stops using its
 * cached client, then `DROP DATABASE … WITH (FORCE)`, both roles, and the registry and slug rows.
 * Audit rows stay. Runs as the superuser: only it may end the app role's sessions.
 */
export async function dropPractice(options: DropPracticeOptions): Promise<void> {
  requireLocal(options.appEnv);
  const names = practiceNames(options.practiceId);
  await withConnection(urlConnectionConfig(options.platformUrl), (platform) =>
    markDeprovisioning(platform, names.practiceId),
  );
  await withConnection(urlConnectionConfig(options.adminUrl), async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(names.databaseName)} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${quoteIdent(names.appRole)}`);
    await admin.query(`DROP ROLE IF EXISTS ${quoteIdent(names.ownerRole)}`);
  });
  await withConnection(urlConnectionConfig(options.platformUrl), (platform) =>
    deletePractice(platform, names.practiceId),
  );
}

/** Rows per table, inserted in the order given; values are bind parameters. */
export type PracticeFixture = Readonly<
  Record<string, readonly Readonly<Record<string, unknown>>[]>
>;

/**
 * Writes fixture rows into a practice database as its owner, in one transaction: quoted
 * identifiers, parameterised values, the tables in the order of `data` (parents first).
 */
export async function seedPracticeFixture(
  practice: Pick<ProvisionedPractice, 'connectAsOwner'>,
  data: PracticeFixture,
): Promise<void> {
  const client = await practice.connectAsOwner();
  try {
    await client.query('BEGIN');
    for (const [table, rows] of Object.entries(data)) {
      for (const row of rows) {
        const columns = Object.keys(row);
        const statement =
          columns.length === 0
            ? `INSERT INTO ${quoteIdent(table)} DEFAULT VALUES`
            : `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}) VALUES (${columns.map((_, index) => `$${String(index + 1)}`).join(', ')})`;
        await client.query(statement, Object.values(row));
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

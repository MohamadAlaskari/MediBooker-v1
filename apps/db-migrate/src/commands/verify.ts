import type { Client, ClientConfig } from 'pg';
import { mapWithConcurrency } from '../lib/concurrency.ts';
import {
  clusterAccessResolver,
  createCaFiles,
  pgConnectionConfig,
  prismaDatasourceUrl,
  type ClusterAccess,
  type Credentials,
} from '../lib/cluster.ts';
import {
  requireSecretStore,
  runAudited,
  type ExitCode,
  type PracticeCommandOptions,
} from '../lib/command.ts';
import { TOOL_APPLICATION_NAME, withConnection } from '../lib/database.ts';
import { readSchemaVersion } from '../lib/deploy.ts';
import { toErrorCode, ToolError, type ErrorCode } from '../lib/errors.ts';
import { classifyDeployFailure } from '../lib/migrations.ts';
import { practiceNames, type PracticeNames } from '../lib/names.ts';
import { elapsedMs, practiceLine } from '../lib/output.ts';
import { runPrisma } from '../lib/prisma-cli.ts';
import {
  listClusters,
  listPractices,
  MIGRATED_STATUSES,
  type PracticeRecord,
} from '../lib/registry.ts';
import type { SecretStore } from '../lib/secret-store.ts';

export interface VerifyOptions extends PracticeCommandOptions {
  /** `--practice <id>`: only this practice. */
  readonly practiceId: string | undefined;
  /** MIGRATION_CONCURRENCY. */
  readonly concurrency: number;
  /** MIGRATION_TIMEOUT_MS, per Prisma process. */
  readonly timeoutMs: number;
}

/** The application name of verify's Prisma connections; the runner's timeout never ends them. */
const VERIFY_APPLICATION_NAME = 'medibooker-verify';

/** The findings that make verify exit with 2 (ADR 0005 §6.7). */
const FINDINGS: readonly ErrorCode[] = ['SCHEMA_DRIFT', 'DATABASE_ACL_INVALID'];

interface AclEntry {
  readonly grantee: string;
  readonly privilege: string;
}

/**
 * Whether a practice database's ACL is exactly its owner plus `practice_<id32>_app=c`
 * (ADR 0005 §4.2): the owner's CREATE, TEMPORARY and CONNECT, the app role's CONNECT, nothing
 * for PUBLIC or any other role. A NULL ACL (`hasDefaultAcl`) means PostgreSQL's default, which
 * grants CONNECT to PUBLIC.
 */
export function isExactPracticeAcl(
  hasDefaultAcl: boolean,
  entries: readonly AclEntry[],
  names: Pick<PracticeNames, 'appRole' | 'ownerRole'>,
): boolean {
  if (hasDefaultAcl) return false;
  const actual = new Set(entries.map((entry) => `${entry.grantee}:${entry.privilege}`));
  const expected = new Set([
    `${names.ownerRole}:CREATE`,
    `${names.ownerRole}:TEMPORARY`,
    `${names.ownerRole}:CONNECT`,
    `${names.appRole}:CONNECT`,
  ]);
  return actual.size === expected.size && [...expected].every((entry) => actual.has(entry));
}

const ACL_QUERY = `SELECT d.datacl IS NULL AS default_acl,
  coalesce(r.rolname, 'PUBLIC') AS grantee, a.privilege_type AS privilege
FROM pg_database d
LEFT JOIN LATERAL aclexplode(d.datacl) a ON true
LEFT JOIN pg_roles r ON r.oid = a.grantee
WHERE d.datname = current_database()`;

async function hasExactAcl(client: Client, names: PracticeNames): Promise<boolean> {
  const result = await client.query<{
    default_acl: boolean;
    grantee: string;
    privilege: string | null;
  }>(ACL_QUERY);
  const hasDefaultAcl = result.rows.some((row) => row.default_acl);
  const entries = result.rows.flatMap((row) =>
    row.privilege === null ? [] : [{ grantee: row.grantee, privilege: row.privilege }],
  );
  return isExactPracticeAcl(hasDefaultAcl, entries, names);
}

/** `migrate diff --from-config-datasource --to-schema … --exit-code`: 2 means drift. */
async function checkDrift(
  options: VerifyOptions,
  access: ClusterAccess,
  owner: Credentials,
  caFile: string | undefined,
): Promise<ErrorCode | null> {
  const url = prismaDatasourceUrl(access, owner, {
    applicationName: VERIFY_APPLICATION_NAME,
    caFile,
  });
  const run = await runPrisma({
    args: [
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/practice/schema.prisma',
      '--exit-code',
      '--config',
      'prisma.practice.config.ts',
    ],
    cwd: options.prismaRoot,
    env: { PRACTICE_MIGRATION_URL: url },
    timeoutMs: options.timeoutMs,
  });
  if (run.timedOut) return 'MIGRATION_TIMEOUT';
  if (run.exitCode === 0) return null;
  if (run.exitCode === 2) return 'SCHEMA_DRIFT';
  const failure = classifyDeployFailure(run.output);
  return failure.kind === 'connection' ? failure.code : 'PRISMA_CLI_FAILED';
}

async function verifyPractice(
  options: VerifyOptions,
  store: SecretStore,
  practice: PracticeRecord,
  accessOf: (clusterId: string | null) => Promise<ClusterAccess>,
  caFileOf: (access: ClusterAccess) => Promise<string | undefined>,
): Promise<ErrorCode | null> {
  const start = performance.now();
  let live: string | null = null;
  let errorCode: ErrorCode | null;
  try {
    if (practice.databaseName === null) throw new ToolError('CLUSTER_NOT_FOUND');
    if (practice.ownerSecretRef === null) throw new ToolError('SECRET_UNRESOLVABLE');
    const names = practiceNames(practice.id);
    const owner = {
      user: names.ownerRole,
      password: await store.get(practice.ownerSecretRef),
      database: practice.databaseName,
    };
    const access = await accessOf(practice.clusterId);
    const connection: ClientConfig = pgConnectionConfig(access, owner, TOOL_APPLICATION_NAME);
    const aclIsExact = await withConnection(connection, (client) => hasExactAcl(client, names));
    live = await readSchemaVersion(connection);
    const drift = await checkDrift(options, access, owner, await caFileOf(access));
    errorCode = aclIsExact ? drift : 'DATABASE_ACL_INVALID';
  } catch (error) {
    errorCode = toErrorCode(error);
  }
  options.output.write(practiceLine(practice.id, practice.schemaVersion, live, start, errorCode));
  return errorCode;
}

/**
 * `verify [--practice <id>]` (ADR 0005 §6.7): per practice, the live schema against
 * `prisma/practice/schema.prisma` and the database ACL, MIGRATION_CONCURRENCY at a time. Exit
 * code 2 when any practice drifted or has a wrong ACL, 1 when one could not be checked.
 */
export async function verify(options: VerifyOptions): Promise<ExitCode> {
  const start = performance.now();
  let results: (ErrorCode | null)[] = [];
  const errorCode = await runAudited(
    options,
    { action: 'medibooker-db.verify', practiceId: options.practiceId ?? null },
    async (platform) => {
      const store = requireSecretStore(options.secretStore);
      const practices = await listPractices(platform, MIGRATED_STATUSES, options.practiceId);
      if (options.practiceId !== undefined && practices.length === 0) {
        throw new ToolError('PRACTICE_NOT_FOUND');
      }
      const accessOf = clusterAccessResolver(await listClusters(platform), {
        appEnv: options.appEnv,
        endpoints: options.clusterEndpoints,
        secretStore: store,
      });
      const caFiles = createCaFiles();
      try {
        results = await mapWithConcurrency(practices, options.concurrency, (practice) =>
          verifyPractice(options, store, practice, accessOf, (access) => caFiles.pathFor(access)),
        );
      } finally {
        await caFiles.dispose();
      }
      return null;
    },
  );
  const failed = results.filter((result) => result !== null);
  options.output.write({
    command: 'verify',
    practices: results.length,
    failed: failed.length,
    durationMs: elapsedMs(start),
    errorCode,
  });
  if (failed.some((result) => FINDINGS.includes(result))) return 2;
  return errorCode === null && failed.length === 0 ? 0 : 1;
}

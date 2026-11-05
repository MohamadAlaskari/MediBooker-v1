/**
 * `pnpm db:seed` (02 §9, 07 §2): provisions the two seed practices with the real provisioning
 * code, as medibooker_provisioner and never as the superuser, registers their current slugs and
 * keeps a migrated practice_template for the test copies. Deterministic, synthetic, fixed ids:
 * a second run changes no row count. Local and CI only; run by tsx after `pnpm db:migrate`.
 * Prints JSON lines only, never a host, user, connection string or password.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDevSecretStore,
  DEFAULT_CONNECTION_LIMITS,
  DEFAULT_MIGRATION_TIMEOUT_MS,
  DEFAULT_PRISMA_ROOT,
  isLocalOrCi,
  jsonLineSink,
  newestMigration,
  parseToolEnvironment,
  toErrorCode,
  ToolError,
  type AppEnv,
  type ClusterEndpoints,
  type ConnectionLimits,
  type ErrorCode,
  type OutputSink,
  type SecretStore,
} from '@medibooker/db-migrate';
import {
  ensurePracticeTemplate,
  loadWorkspaceEnv,
  provisionPractice,
} from '@medibooker/db-migrate/testing';
import { Client } from 'pg';

/**
 * The seed practices of 02 §9: `al-noor` in Riyadh (no DST, Friday and Saturday weekend) and
 * `lindenhof` in Berlin (DST). Names, time zones, locales and the practice data arrive with P01.
 */
export const SEED_PRACTICES = [
  { id: '00000000-0000-4000-8000-000000000001', slug: 'al-noor', market: 'SA' },
  { id: '00000000-0000-4000-8000-000000000002', slug: 'lindenhof', market: 'DE' },
] as const;

export interface SeedOptions {
  readonly appEnv: AppEnv;
  /** PLATFORM_MIGRATION_URL: the registry and the slugs, as platform_owner. */
  readonly platformUrl: string;
  /** PROVISIONER_DATABASE_URL: registers the cluster `local` when none exists. */
  readonly provisionerUrl: string;
  /** DATABASE_ADMIN_URL: the cluster superuser, only for practice_template. */
  readonly adminUrl: string;
  readonly secretStore: SecretStore;
  readonly prismaRoot?: string;
  readonly clusterEndpoints?: ClusterEndpoints;
  readonly connectionLimits?: ConnectionLimits;
  readonly migrationTimeoutMs?: number;
  /** Where provisioning writes its JSON lines; by default nowhere. */
  readonly output?: OutputSink;
}

export interface SeedResult {
  /** Practices this run provisioned; 0 when both were already current. */
  readonly provisioned: number;
  readonly templateRefreshed: boolean;
}

async function withPlatform<T>(
  platformUrl: string,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: platformUrl, application_name: 'medibooker-seed' });
  // An error on the idle connection surfaces through the next query, never as a crash.
  client.on('error', () => undefined);
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Whether the practice is ACTIVE at the newest practice migration already. */
async function isCurrent(
  platformUrl: string,
  practiceId: string,
  newest: string,
): Promise<boolean> {
  return withPlatform(platformUrl, async (client) => {
    const result = await client.query<{ current: boolean }>(
      "SELECT status = 'ACTIVE' AND schema_version = $2 AS current FROM practices WHERE id = $1",
      [practiceId, newest],
    );
    return result.rows[0]?.current === true;
  });
}

async function registerSlug(platformUrl: string, practiceId: string, slug: string): Promise<void> {
  await withPlatform(platformUrl, (client) =>
    client.query(
      'INSERT INTO practice_slugs (slug, practice_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [slug, practiceId],
    ),
  );
}

/**
 * Seeds one cluster with explicit connections, so the integration harness can run it against
 * its own cluster. A practice that is ACTIVE at the newest migration is left alone, so a second
 * run writes nothing, not even audit rows; a practice behind it is provisioned again, which
 * migrates it.
 */
export async function seed(options: SeedOptions): Promise<SeedResult> {
  if (!isLocalOrCi(options.appEnv)) throw new ToolError('LOCAL_ONLY');
  const prismaRoot = options.prismaRoot ?? DEFAULT_PRISMA_ROOT;
  const migrationTimeoutMs = options.migrationTimeoutMs ?? DEFAULT_MIGRATION_TIMEOUT_MS;
  const newest = newestMigration(prismaRoot, 'practice');
  let provisioned = 0;
  for (const practice of SEED_PRACTICES) {
    if (!(await isCurrent(options.platformUrl, practice.id, newest))) {
      await provisionPractice({
        practiceId: practice.id,
        market: practice.market,
        appEnv: options.appEnv,
        platformUrl: options.platformUrl,
        provisionerUrl: options.provisionerUrl,
        secretStore: options.secretStore,
        prismaRoot,
        clusterEndpoints: options.clusterEndpoints ?? new Map(),
        connectionLimits: options.connectionLimits ?? DEFAULT_CONNECTION_LIMITS,
        migrationTimeoutMs,
        ...(options.output === undefined ? {} : { output: options.output }),
      });
      provisioned += 1;
    }
    await registerSlug(options.platformUrl, practice.id, practice.slug);
  }
  const template = await ensurePracticeTemplate({
    appEnv: options.appEnv,
    adminUrl: options.adminUrl,
    prismaRoot,
    migrationTimeoutMs,
  });
  return { provisioned, templateRefreshed: template.refreshed };
}

/** `tsx prisma/seed.ts`: the root .env and the environment, then one summary line. */
async function main(): Promise<number> {
  const output = jsonLineSink((text) => {
    process.stdout.write(text);
  });
  const start = performance.now();
  const summary = (
    errorCode: ErrorCode | null,
    practices: number,
    invalidKeys?: readonly string[],
  ): number => {
    output.write({
      command: 'seed',
      practices,
      failed: errorCode === null ? 0 : 1,
      durationMs: Math.round(performance.now() - start),
      errorCode,
      ...(invalidKeys === undefined ? {} : { invalidKeys }),
    });
    return errorCode === null ? 0 : 1;
  };
  try {
    loadWorkspaceEnv();
    const parsed = parseToolEnvironment(process.env);
    if (!parsed.ok) return summary('ENVIRONMENT_INVALID', 0, parsed.invalidKeys);
    const env = parsed.value;
    if (!isLocalOrCi(env.appEnv)) return summary('LOCAL_ONLY', 0);
    const { platformUrl, provisionerUrl, adminUrl } = env;
    if (
      platformUrl === undefined ||
      provisionerUrl === undefined ||
      adminUrl === undefined ||
      env.secretStore !== 'dev'
    ) {
      const missing = [
        platformUrl === undefined ? 'PLATFORM_MIGRATION_URL' : '',
        provisionerUrl === undefined ? 'PROVISIONER_DATABASE_URL' : '',
        adminUrl === undefined ? 'DATABASE_ADMIN_URL' : '',
        env.secretStore === 'dev' ? '' : 'SECRET_STORE',
      ].filter((key) => key !== '');
      return summary('ENVIRONMENT_INVALID', 0, missing);
    }
    const result = await seed({
      appEnv: env.appEnv,
      platformUrl,
      provisionerUrl,
      adminUrl,
      secretStore: createDevSecretStore({
        appEnv: env.appEnv,
        seed: env.devSecretSeed,
        environment: process.env,
      }),
      prismaRoot: env.prismaRoot,
      clusterEndpoints: env.clusterEndpoints,
      connectionLimits: env.connectionLimits,
      migrationTimeoutMs: env.migrationTimeoutMs,
      output,
    });
    return summary(null, result.provisioned);
  } catch (error) {
    // Only the code, never the error itself: its message could name a host or a role.
    return summary(toErrorCode(error), 0);
  }
}

// tsx leaves import.meta.main unset, so the entry is recognised by its path; the integration
// harness imports seed() without running it.
const isEntry =
  path.relative(path.resolve(process.argv[1] ?? ''), fileURLToPath(import.meta.url)) === '';
if (isEntry) process.exitCode = await main();

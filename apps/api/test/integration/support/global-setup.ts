/**
 * The global setup of the integration project (02 §12, 06 §3). It starts one PostgreSQL cluster
 * for the run, as 01-cluster.sh prepares every cluster, and builds what the test files copy:
 *
 * 1. platform_template and practice_template with the builtin C.UTF-8 locale, migrated with
 *    `migrate deploy` by their owners through medibooker-db's own functions (platform_owner and
 *    the superuser, which owns practice_template as `pnpm db:seed` creates it);
 * 2. the copies platform_drift and practice_drift for migrations.int-spec.ts;
 * 3. both templates marked IS_TEMPLATE and ALLOW_CONNECTIONS false: PostgreSQL copies a database
 *    only while no session is connected to it, so nothing may connect once copies start.
 *
 * The teardown stops and removes the container. CI runs without Testcontainers' ryuk
 * (TESTCONTAINERS_RYUK_DISABLED), so this teardown is what removes it there.
 */
import {
  DEFAULT_MIGRATION_TIMEOUT_MS,
  DEFAULT_PRISMA_ROOT,
  migrate,
  type OutputLine,
} from '@medibooker/db-migrate';
import { ensurePracticeTemplate } from '@medibooker/db-migrate/testing';
import type { TestProject } from 'vitest/node';
import {
  clusterContainer,
  generateClusterSecrets,
  PLATFORM_DRIFT,
  PLATFORM_TEMPLATE,
  PRACTICE_DRIFT,
  roleUrl,
  type IntegrationCluster,
} from './cluster.js';
import { withClient } from './sql.js';

/** The operator principal of the harness's own audit rows: synthetic, never an OS user. */
const HARNESS_ACTOR = 'local:integration-harness';

async function migratePlatformTemplate(cluster: IntegrationCluster): Promise<void> {
  const lines: OutputLine[] = [];
  const exitCode = await migrate({
    target: 'platform',
    practiceId: undefined,
    appEnv: 'ci',
    platformUrl: roleUrl(cluster, 'platform_owner', PLATFORM_TEMPLATE),
    actor: HARNESS_ACTOR,
    output: {
      write: (line) => {
        lines.push(line);
      },
    },
    secretStore: undefined,
    prismaRoot: DEFAULT_PRISMA_ROOT,
    clusterEndpoints: new Map(),
    concurrency: 1,
    timeoutMs: DEFAULT_MIGRATION_TIMEOUT_MS,
    lockRetries: 0,
  });
  if (exitCode !== 0) {
    // Error codes only: the output carries no host, user or password (02 §6).
    const codes = lines.flatMap((line) => (line.errorCode === null ? [] : [line.errorCode]));
    throw new Error(`migrate platform failed on ${PLATFORM_TEMPLATE}: ${codes.join(', ')}`);
  }
}

async function prepareDatabases(cluster: IntegrationCluster): Promise<void> {
  const superuser = roleUrl(cluster, 'postgres', 'postgres');
  await withClient(superuser, (admin) =>
    admin.query(
      `CREATE DATABASE ${PLATFORM_TEMPLATE} OWNER platform_owner TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'`,
    ),
  );
  await migratePlatformTemplate(cluster);
  // Creates, migrates and marks practice_template, exactly as `pnpm db:seed` does.
  await ensurePracticeTemplate({
    appEnv: 'ci',
    adminUrl: superuser,
    prismaRoot: DEFAULT_PRISMA_ROOT,
    migrationTimeoutMs: DEFAULT_MIGRATION_TIMEOUT_MS,
  });
  await withClient(superuser, async (admin) => {
    await admin.query(
      `CREATE DATABASE ${PLATFORM_DRIFT} OWNER platform_owner TEMPLATE ${PLATFORM_TEMPLATE}`,
    );
    await admin.query(`CREATE DATABASE ${PRACTICE_DRIFT} TEMPLATE practice_template`);
    await admin.query(
      `ALTER DATABASE ${PLATFORM_TEMPLATE} WITH IS_TEMPLATE true ALLOW_CONNECTIONS false`,
    );
  });
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const secrets = generateClusterSecrets();
  const container = await clusterContainer(secrets).start();
  try {
    const cluster: IntegrationCluster = {
      containerId: container.getId(),
      host: container.getHost(),
      port: container.getPort(),
      secrets,
    };
    await prepareDatabases(cluster);
    project.provide('integrationCluster', cluster);
  } catch (error) {
    await container.stop();
    throw error;
  }
  return async () => {
    await container.stop();
  };
}

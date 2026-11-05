/**
 * Both migration sets (08 F04): the global setup applied each one with `migrate deploy` to an
 * empty database and copied the result to platform_drift and practice_drift; this spec checks
 * what was applied and compares each copy with its schema.prisma (02 §9, drift check).
 */
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { DEFAULT_PRISMA_ROOT } from '@medibooker/db-migrate';
import { describe, expect, inject, it } from 'vitest';
import { PLATFORM_DRIFT, PRACTICE_DRIFT, roleUrl, type ClusterRole } from './support/cluster.js';
import { runNode } from './support/run-node.js';
import { withClient } from './support/sql.js';
import { toolEnv } from './support/tool-env.js';

const PRISMA_CLI = createRequire(import.meta.url).resolve('prisma/build/index.js');

interface SchemaCase {
  readonly schema: 'platform' | 'practice';
  readonly database: string;
  /** The owner of the migrated objects: platform_owner, or the superuser for practice_template. */
  readonly role: ClusterRole;
  /** The variable the schema's Prisma config reads its datasource URL from. */
  readonly variable: string;
}

const SCHEMAS: readonly SchemaCase[] = [
  {
    schema: 'platform',
    database: PLATFORM_DRIFT,
    role: 'platform_owner',
    variable: 'PLATFORM_MIGRATION_URL',
  },
  {
    schema: 'practice',
    database: PRACTICE_DRIFT,
    role: 'postgres',
    variable: 'PRACTICE_MIGRATION_URL',
  },
];

function migrationFolders(schema: SchemaCase['schema']): string[] {
  return readdirSync(path.join(DEFAULT_PRISMA_ROOT, 'prisma', schema, 'migrations'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe('the migration sets (08 F04)', () => {
  const cluster = inject('integrationCluster');

  it.each(SCHEMAS)(
    '08 F04 applies every $schema migration to an empty PostgreSQL 18 database',
    async ({ schema, database, role }) => {
      const applied = await withClient(roleUrl(cluster, role, database), async (client) => {
        const server = await client.query<{ major: number }>(
          "SELECT current_setting('server_version_num')::int / 10000 AS major",
        );
        const migrations = await client.query<{
          name: string;
          finished: boolean;
          rolledBack: boolean;
        }>(
          `SELECT migration_name AS name, finished_at IS NOT NULL AS finished,
             rolled_back_at IS NOT NULL AS "rolledBack"
           FROM _prisma_migrations ORDER BY migration_name`,
        );
        return { major: server.rows[0]?.major, migrations: migrations.rows };
      });
      expect(applied.major).toBe(18);
      expect(applied.migrations).toEqual(
        migrationFolders(schema).map((name) => ({ name, finished: true, rolledBack: false })),
      );
    },
  );

  it.each(SCHEMAS)(
    '02 §9 finds no drift between the migrated $schema database and its schema.prisma',
    async ({ schema, database, role, variable }) => {
      const run = await runNode(
        [
          PRISMA_CLI,
          'migrate',
          'diff',
          '--from-config-datasource',
          '--to-schema',
          `prisma/${schema}/schema.prisma`,
          '--exit-code',
          '--config',
          `prisma.${schema}.config.ts`,
        ],
        {
          cwd: DEFAULT_PRISMA_ROOT,
          env: toolEnv({ [variable]: roleUrl(cluster, role, database) }),
        },
      );
      expect(run.exitCode).toBe(0);
      // Without a datasource the CLI also exits 0, silently: the message proves the comparison ran.
      expect(run.stdout).toContain('No difference detected');
    },
  );
});

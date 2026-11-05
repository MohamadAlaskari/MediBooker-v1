/**
 * The test helpers of `@medibooker/db-migrate/testing` (02 §6, 01 §3), which the seed, this
 * harness and from P06 the web e2e fixtures use: template copies, fixtures, teardown, the
 * workspace .env and the template itself.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_MIGRATION_TIMEOUT_MS,
  DEFAULT_PRISMA_ROOT,
  newestMigration,
  practiceNames,
} from '@medibooker/db-migrate';
import {
  dropPractice,
  ensurePracticeTemplate,
  loadWorkspaceEnv,
  provisionPractice,
  seedPracticeFixture,
  type ProvisionedPractice,
} from '@medibooker/db-migrate/testing';
import { describe, expect, it } from 'vitest';
import { usePracticeDatabases } from '../support/practices.js';
import { createFixturePrismaRoot } from './support/prisma-root.js';
import { statementOutcome, withClient, type Row } from './support/sql.js';

const NEWEST_PRACTICE_MIGRATION = newestMigration(DEFAULT_PRISMA_ROOT, 'practice');

describe('@medibooker/db-migrate/testing (02 §6)', () => {
  const databases = usePracticeDatabases();

  /** A practice database's catalog entry, read as the superuser. */
  async function databaseEntry(practice: ProvisionedPractice): Promise<unknown> {
    return withClient(databases.superuserUrl(), async (admin) => {
      const result = await admin.query<Row>(
        `SELECT d.datlocprovider AS "localeProvider", d.datlocale AS locale,
           pg_encoding_to_char(d.encoding) AS encoding, d.datacl::text[] AS acl,
           (SELECT s.setconfig FROM pg_db_role_setting s
            WHERE s.setdatabase = d.oid AND s.setrole = 0) AS settings
         FROM pg_database d WHERE d.datname = $1`,
        [practice.databaseName],
      );
      return result.rows[0];
    });
  }

  it('02 §6 provisionPractice copies practice_template with the production ACL, locale and identity', async () => {
    const practice = databases.practiceA;
    const { appRole, ownerRole } = practiceNames(practice.practiceId);
    expect(await databaseEntry(practice)).toEqual({
      localeProvider: 'b',
      locale: 'C.UTF-8',
      encoding: 'UTF8',
      acl: [`${ownerRole}=CTc/${ownerRole}`, `${appRole}=c/${ownerRole}`],
      settings: [`medibooker.app_role=${appRole}`],
    });
    const registry = await withClient(databases.platformOwnerUrl, async (platform) => {
      const result = await platform.query<Row>(
        `SELECT status, market, cluster_id AS "clusterId", database_name AS "databaseName",
           app_secret_ref AS "appSecretRef", owner_secret_ref AS "ownerSecretRef",
           schema_version AS "schemaVersion"
         FROM practices WHERE id = $1`,
        [practice.practiceId],
      );
      return result.rows;
    });
    expect(registry).toEqual([
      {
        status: 'ACTIVE',
        market: 'SA',
        clusterId: 'local',
        databaseName: practice.databaseName,
        appSecretRef: `dev:${appRole}`,
        ownerSecretRef: `dev:${ownerRole}`,
        schemaVersion: NEWEST_PRACTICE_MIGRATION,
      },
    ]);
    const app = await databases.connectAsApp(practice);
    try {
      const identity = await app.query<{ practice_id: string }>(
        'SELECT practice_id FROM practice_identity',
      );
      expect(identity.rows).toEqual([{ practice_id: practice.practiceId }]);
      expect(
        await statementOutcome(app, 'UPDATE practice_identity SET practice_id = $1', [
          randomUUID(),
        ]),
      ).toMatchObject({ code: '42501' });
    } finally {
      await app.end();
    }
  });

  it('02 §6 provisionPractice refuses a practice_template behind the newest migration with "run pnpm db:seed"', async () => {
    const prismaRoot = createFixturePrismaRoot();
    try {
      // A newer migration than the one practice_template records as its comment.
      prismaRoot.addPracticeMigration('29990101000000_newer_than_template', 'SELECT 1;\n');
      const practiceId = randomUUID();
      databases.dropOnTeardown(practiceId);
      await expect(
        provisionPractice({
          practiceId,
          market: 'SA',
          appEnv: 'ci',
          platformUrl: databases.platformOwnerUrl,
          provisionerUrl: databases.provisionerUrl,
          adminUrl: databases.superuserUrl(),
          secretStore: databases.secretStore,
          prismaRoot: prismaRoot.path,
          fromTemplate: true,
        }),
      ).rejects.toMatchObject({
        code: 'TEMPLATE_STALE',
        message: expect.stringContaining('run pnpm db:seed') as unknown,
      });
    } finally {
      prismaRoot.dispose();
    }
  });

  it('02 §6 seedPracticeFixture writes the rows of a fixture as the owner in one transaction', async () => {
    const practice = databases.practiceB;
    const owner = await practice.connectAsOwner();
    try {
      await owner.query(
        'CREATE TABLE fixture_patients (id integer PRIMARY KEY, name text NOT NULL)',
      );
      await seedPracticeFixture(practice, {
        fixture_patients: [
          { id: 1, name: 'سارة أحمد' },
          { id: 2, name: 'Sara Ahmed' },
        ],
      });
      // The second row repeats id 1: the whole fixture is rolled back, row 3 included.
      await expect(
        seedPracticeFixture(practice, {
          fixture_patients: [
            { id: 3, name: 'Lina Haddad' },
            { id: 1, name: 'Omar Khalil' },
          ],
        }),
      ).rejects.toMatchObject({ code: '23505' });
      const rows = await owner.query<Row>('SELECT id, name FROM fixture_patients ORDER BY id');
      expect(rows.rows).toEqual([
        { id: 1, name: 'سارة أحمد' },
        { id: 2, name: 'Sara Ahmed' },
      ]);
    } finally {
      await owner.end();
    }
  });

  it('02 §6 dropPractice ends open sessions, removes the database, both roles, registry and slugs, and keeps the audit rows', async () => {
    const practice = await databases.provision({ path: 'full' });
    const { appRole, ownerRole } = practiceNames(practice.practiceId);
    await withClient(databases.platformAppUrl, (platform) =>
      platform.query('INSERT INTO practice_slugs (slug, practice_id) VALUES ($1, $2)', [
        'dar-al-shifa',
        practice.practiceId,
      ]),
    );
    const openSession = await databases.connectAsApp(practice);

    await dropPractice({
      practiceId: practice.practiceId,
      appEnv: 'ci',
      platformUrl: databases.platformOwnerUrl,
      adminUrl: databases.superuserUrl(),
    });

    expect(await statementOutcome(openSession, 'SELECT 1')).not.toBe('succeeded');
    await openSession.end().catch(() => undefined);
    const cluster = await withClient(databases.superuserUrl(), async (admin) => {
      const database = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        practice.databaseName,
      ]);
      const roles = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = ANY($1)', [
        [appRole, ownerRole],
      ]);
      return { databases: database.rowCount, roles: roles.rowCount };
    });
    expect(cluster).toEqual({ databases: 0, roles: 0 });
    const platform = await withClient(databases.platformOwnerUrl, async (client) => {
      const count = async (sql: string): Promise<number> =>
        Number((await client.query<{ count: string }>(sql, [practice.practiceId])).rows[0]?.count);
      return {
        practices: await count('SELECT count(*) AS count FROM practices WHERE id = $1'),
        slugs: await count('SELECT count(*) AS count FROM practice_slugs WHERE practice_id = $1'),
        auditEvents: await count(
          'SELECT count(*) AS count FROM platform_audit_events WHERE practice_id = $1',
        ),
      };
    });
    // The full provisioning path wrote its STARTED and SUCCEEDED rows (ADR 0005 §5.2).
    expect(platform).toEqual({ practices: 0, slugs: 0, auditEvents: 2 });
  });

  it("02 §6 loadWorkspaceEnv loads the workspace's .env without replacing a set variable", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'medibooker-workspace-'));
    try {
      writeFileSync(path.join(workspace, 'pnpm-workspace.yaml'), 'packages: []\n');
      writeFileSync(
        path.join(workspace, '.env'),
        'MEDIBOOKER_HARNESS_FROM_FILE=from-file\nMEDIBOOKER_HARNESS_KEPT=from-file\n',
      );
      const packageDir = path.join(workspace, 'apps', 'web');
      mkdirSync(packageDir, { recursive: true });
      process.env.MEDIBOOKER_HARNESS_KEPT = 'from-environment';

      loadWorkspaceEnv(packageDir);

      expect({
        fromFile: process.env.MEDIBOOKER_HARNESS_FROM_FILE,
        kept: process.env.MEDIBOOKER_HARNESS_KEPT,
      }).toEqual({ fromFile: 'from-file', kept: 'from-environment' });
    } finally {
      delete process.env.MEDIBOOKER_HARNESS_FROM_FILE;
      delete process.env.MEDIBOOKER_HARNESS_KEPT;
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('02 §6 ensurePracticeTemplate leaves a current practice_template as it is', async () => {
    expect(
      await ensurePracticeTemplate({
        appEnv: 'ci',
        adminUrl: databases.superuserUrl(),
        prismaRoot: DEFAULT_PRISMA_ROOT,
        migrationTimeoutMs: DEFAULT_MIGRATION_TIMEOUT_MS,
      }),
    ).toEqual({ refreshed: false, version: NEWEST_PRACTICE_MIGRATION });
    const template = await withClient(databases.superuserUrl(), async (admin) => {
      const result = await admin.query<Row>(
        `SELECT datistemplate AS "isTemplate", datallowconn AS "allowsConnections",
           shobj_description(oid, 'pg_database') AS version
         FROM pg_database WHERE datname = 'practice_template'`,
      );
      return result.rows;
    });
    expect(template).toEqual([
      { isTemplate: true, allowsConnections: false, version: NEWEST_PRACTICE_MIGRATION },
    ]);
  });
});

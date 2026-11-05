/**
 * Credentials and the two barriers between practices, at the database level (ADR 0005 §4.2-§4.4,
 * §11.5): CONNECT on each practice database for its own app role only, and table privileges
 * granted by the migrations to that role only. Practices A and B are provisioned on the full path
 * as medibooker_provisioner; the connection manager's own refusals are API tests.
 */
import { randomUUID } from 'node:crypto';
import { createPracticeDatabase } from '@medibooker/db-migrate';
import type { ProvisionedPractice } from '@medibooker/db-migrate/testing';
import { describe, expect, inject, it } from 'vitest';
import { usePracticeDatabases } from '../../support/practices.js';
import { CLUSTER_PLATFORM_DATABASE } from '../support/cluster.js';
import { generatedSecrets, secretNamesIn } from '../support/secrets.js';
import { readServerLog } from '../support/server-log.js';
import { connectionOutcome, quoteIdent, statementOutcome, withClient } from '../support/sql.js';

describe('practice credentials and database privileges (ADR 0005 §4, §11.5)', () => {
  const databases = usePracticeDatabases({ practices: 'full' });
  const cluster = inject('integrationCluster');

  function permissionDeniedForDatabase(database: string): unknown {
    return { code: '42501', message: `permission denied for database "${database}"` };
  }

  it("ADR-0005 §11.5 A's app role gets permission denied for database on B's database", async () => {
    const { practiceA, practiceB } = databases;
    expect(
      await connectionOutcome(await databases.appConnection(practiceA, practiceB.databaseName)),
    ).toEqual(permissionDeniedForDatabase(practiceB.databaseName));
    // The control: A's role connects to its own database.
    expect(await connectionOutcome(await databases.appConnection(practiceA))).toBe('succeeded');
  });

  it("ADR-0005 §11.5 A's app role gets permission denied for database on a copy of B", async () => {
    const { practiceA, practiceB } = databases;
    const copy = `${practiceB.databaseName}_copy`;
    await withClient(databases.superuserUrl(), (admin) =>
      // The way restore and move create a database of B (ADR 0005 §4.2).
      createPracticeDatabase(
        admin,
        { databaseName: copy, ownerRole: practiceB.ownerRole, appRole: practiceB.appRole },
        { template: practiceB.databaseName },
      ),
    );
    try {
      expect(await connectionOutcome(await databases.appConnection(practiceA, copy))).toEqual(
        permissionDeniedForDatabase(copy),
      );
    } finally {
      await withClient(databases.superuserUrl(), (admin) =>
        admin.query(`DROP DATABASE ${quoteIdent(copy)} WITH (FORCE)`),
      );
    }
  });

  it("ADR-0005 §11.5 A's app role gets permission denied for database on the platform databases", async () => {
    const { practiceA } = databases;
    for (const database of [CLUSTER_PLATFORM_DATABASE, databases.platformDatabase]) {
      expect(await connectionOutcome(await databases.appConnection(practiceA, database))).toEqual(
        permissionDeniedForDatabase(database),
      );
    }
  });

  it("ADR-0005 §11.5 with B's CONNECT opened to PUBLIC, A's app role connects but reads no table of B", async () => {
    const { practiceA, practiceB } = databases;
    const database = quoteIdent(practiceB.databaseName);
    const ownerOfB = await practiceB.connectAsOwner();
    try {
      await ownerOfB.query(`GRANT CONNECT ON DATABASE ${database} TO PUBLIC`);
      const outcomes = await withClient(
        await databases.appConnection(practiceA, practiceB.databaseName),
        async (client) => ({
          identity: await statementOutcome(client, 'SELECT practice_id FROM practice_identity'),
          migrations: await statementOutcome(
            client,
            'SELECT migration_name FROM _prisma_migrations',
          ),
        }),
      );
      expect(outcomes).toEqual({
        identity: { code: '42501', message: 'permission denied for table practice_identity' },
        migrations: { code: '42501', message: 'permission denied for table _prisma_migrations' },
      });
    } finally {
      await ownerOfB.query(`REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`);
      await ownerOfB.end();
    }
  });

  it('ADR-0005 §4.2 the ACL of each practice database is exactly its owner plus its app role with CONNECT', async () => {
    const acls = await withClient(databases.superuserUrl(), async (admin) => {
      const result = await admin.query<{ name: string; acl: string[] }>(
        'SELECT datname AS name, datacl::text[] AS acl FROM pg_database WHERE datname = ANY($1)',
        [[databases.practiceA.databaseName, databases.practiceB.databaseName]],
      );
      return Object.fromEntries(result.rows.map((row) => [row.name, [...row.acl].sort()]));
    });
    const expected = (practice: ProvisionedPractice): string[] =>
      [
        `${practice.ownerRole}=CTc/${practice.ownerRole}`,
        `${practice.appRole}=c/${practice.ownerRole}`,
      ].sort();
    expect(acls).toEqual({
      [databases.practiceA.databaseName]: expected(databases.practiceA),
      [databases.practiceB.databaseName]: expected(databases.practiceB),
    });
  });

  it("ADR-0005 §11.5 A's app role has DML on a new table of its database, but cannot CREATE or DROP", async () => {
    const { practiceA } = databases;
    const owner = await practiceA.connectAsOwner();
    const app = await databases.connectAsApp(practiceA);
    try {
      // A table a later migration creates: the default privileges of the first one cover it.
      await owner.query('CREATE TABLE credential_probe (id integer PRIMARY KEY, note text)');
      const statements = {
        insert: "INSERT INTO credential_probe (id, note) VALUES (1, 'Sara Ahmed')",
        select: 'SELECT id, note FROM credential_probe',
        update: "UPDATE credential_probe SET note = 'سارة أحمد' WHERE id = 1",
        delete: 'DELETE FROM credential_probe WHERE id = 1',
        createTable: 'CREATE TABLE app_probe (id integer)',
        createSchema: 'CREATE SCHEMA app_probe',
        alterTable: 'ALTER TABLE credential_probe ADD COLUMN extra text',
        dropTable: 'DROP TABLE credential_probe',
      };
      const outcomes: Record<string, unknown> = {};
      for (const [name, sql] of Object.entries(statements)) {
        outcomes[name] = await statementOutcome(app, sql);
      }
      expect(outcomes).toEqual({
        insert: 'succeeded',
        select: 'succeeded',
        update: 'succeeded',
        delete: 'succeeded',
        createTable: { code: '42501', message: 'permission denied for schema public' },
        createSchema: {
          code: '42501',
          message: `permission denied for database ${practiceA.databaseName}`,
        },
        alterTable: { code: '42501', message: 'must be owner of table credential_probe' },
        dropTable: { code: '42501', message: 'must be owner of table credential_probe' },
      });
    } finally {
      await app.end();
      await owner.query('DROP TABLE IF EXISTS credential_probe');
      await owner.end();
    }
  });

  it("ADR-0005 §4.3 A's app role reads its practice_identity but cannot change it", async () => {
    const { practiceA, practiceB } = databases;
    const app = await databases.connectAsApp(practiceA);
    try {
      const identity = await app.query<{ id: number; practice_id: string }>(
        'SELECT id, practice_id FROM practice_identity',
      );
      expect(identity.rows).toEqual([{ id: 1, practice_id: practiceA.practiceId }]);
      const denied = { code: '42501', message: 'permission denied for table practice_identity' };
      expect({
        update: await statementOutcome(app, 'UPDATE practice_identity SET practice_id = $1', [
          practiceB.practiceId,
        ]),
        insert: await statementOutcome(
          app,
          'INSERT INTO practice_identity (id, practice_id) VALUES (2, $1)',
          [randomUUID()],
        ),
        delete: await statementOutcome(app, 'DELETE FROM practice_identity'),
      }).toEqual({ update: denied, insert: denied, delete: denied });
    } finally {
      await app.end();
    }
  });

  it('ADR-0005 §4.4 platform_app gets permission denied when it changes routing, status, secret references or clusters', async () => {
    const { practiceId } = databases.practiceA;
    const statements: Record<string, [string, unknown[]]> = {
      clusterId: ["UPDATE practices SET cluster_id = 'local' WHERE id = $1", [practiceId]],
      databaseName: [
        'UPDATE practices SET database_name = $2 WHERE id = $1',
        [practiceId, databases.practiceB.databaseName],
      ],
      appSecretRef: ["UPDATE practices SET app_secret_ref = 'dev:x' WHERE id = $1", [practiceId]],
      ownerSecretRef: [
        "UPDATE practices SET owner_secret_ref = 'dev:x' WHERE id = $1",
        [practiceId],
      ],
      routeVersion: [
        'UPDATE practices SET route_version = route_version + 1 WHERE id = $1',
        [practiceId],
      ],
      status: ["UPDATE practices SET status = 'SUSPENDED' WHERE id = $1", [practiceId]],
      insertPractice: ["INSERT INTO practices (id, market) VALUES ($1, 'SA')", [randomUUID()]],
      deletePractice: ['DELETE FROM practices WHERE id = $1', [practiceId]],
      insertCluster: [
        `INSERT INTO database_clusters (id, region, host, port, tls_mode, database_limit)
         VALUES ('rogue', 'local', 'db.example.test', 5432, 'DISABLE', 1)`,
        [],
      ],
      updateCluster: ["UPDATE database_clusters SET host = 'db.example.test'", []],
      deleteCluster: ['DELETE FROM database_clusters', []],
    };
    const outcomes = await withClient(databases.platformAppUrl, async (client) => {
      const results: Record<string, unknown> = {
        // The control: platform_app reads the registry.
        select: await statementOutcome(client, 'SELECT id, status FROM practices'),
      };
      for (const [name, [sql, values]] of Object.entries(statements)) {
        results[name] = await statementOutcome(client, sql, values);
      }
      return results;
    });
    const denied = (table: string): unknown => ({
      code: '42501',
      message: `permission denied for table ${table}`,
    });
    expect(outcomes).toEqual({
      select: 'succeeded',
      ...Object.fromEntries(
        Object.keys(statements).map((name) => [
          name,
          denied(name.endsWith('Cluster') ? 'database_clusters' : 'practices'),
        ]),
      ),
    });
  });

  it('ADR-0005 §4.6 the server log holds no generated password', async () => {
    const { practiceA, practiceB } = databases;
    // The control: a refused connection with A's password reaches the log. Assertions on the log
    // compare booleans and names, so a failure never prints the log itself.
    await connectionOutcome(await databases.appConnection(practiceA, practiceB.databaseName));
    const refused = `permission denied for database "${practiceB.databaseName}"`;
    await expect
      .poll(async () => (await readServerLog()).includes(refused), { timeout: 10_000 })
      .toBe(true);
    const secrets = generatedSecrets(cluster.secrets, [practiceA.practiceId, practiceB.practiceId]);
    expect(secretNamesIn(await readServerLog(), secrets)).toEqual([]);
  });
});

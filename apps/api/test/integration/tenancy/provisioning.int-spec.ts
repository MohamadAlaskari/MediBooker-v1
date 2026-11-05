/**
 * Provisioning on the full path (ADR 0005 §5.3, 08 F04): `medibooker-db migrate platform` and
 * `medibooker-db provision` on the cluster as 01-cluster.sh prepared it, with its own platform
 * database medibooker_platform, which no other spec uses. The commands get platform_owner's and
 * medibooker_provisioner's credentials only, never the superuser's; the superuser only reads
 * catalogs here and drops the practices at the end.
 */
import { randomUUID } from 'node:crypto';
import {
  createDevSecretStore,
  DEFAULT_CONNECTION_LIMITS,
  DEFAULT_PRISMA_ROOT,
  newestMigration,
  practiceNames,
} from '@medibooker/db-migrate';
import { dropPractice, provisionPractice } from '@medibooker/db-migrate/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { CLUSTER_PLATFORM_DATABASE, roleUrl } from '../support/cluster.js';
import { runMedibookerDb, type CliRun } from '../support/medibooker-db.js';
import { forbiddenIn, generatedSecrets, secretNamesIn } from '../support/secrets.js';
import { readServerLog } from '../support/server-log.js';
import { withClient, type Row } from '../support/sql.js';

const NEWEST_PRACTICE_MIGRATION = newestMigration(DEFAULT_PRISMA_ROOT, 'practice');

describe('provisioning on a cluster prepared only by 01-cluster.sh (ADR 0005 §5.3)', () => {
  const cluster = inject('integrationCluster');
  const platformOwnerUrl = roleUrl(cluster, 'platform_owner', CLUSTER_PLATFORM_DATABASE);
  const provisionerUrl = roleUrl(cluster, 'medibooker_provisioner', 'postgres');
  const superuserUrl = (database = 'postgres'): string => roleUrl(cluster, 'postgres', database);
  /** Provisioned by two complete runs of the command. */
  const practiceId = randomUUID();
  /** Its first run stops after the role step. */
  const stoppedPracticeId = randomUUID();
  const runs: CliRun[] = [];

  async function medibookerDb(args: readonly string[]): Promise<CliRun> {
    const run = await runMedibookerDb(args, {
      PLATFORM_MIGRATION_URL: platformOwnerUrl,
      PROVISIONER_DATABASE_URL: provisionerUrl,
      SECRET_STORE: 'dev',
      DEV_SECRET_SEED: cluster.secrets.DEV_SECRET_SEED,
    });
    runs.push(run);
    return run;
  }

  /** Everything provisioning creates for a practice, as the catalogs and the registry show it. */
  async function practiceState(id: string): Promise<Record<string, unknown>> {
    const names = practiceNames(id);
    const catalog = await withClient(superuserUrl(), async (admin) => {
      const database = await admin.query<Row>(
        `SELECT d.oid::text AS oid, d.datlocprovider AS "localeProvider", d.datlocale AS locale,
           pg_encoding_to_char(d.encoding) AS encoding, pg_get_userbyid(d.datdba) AS owner,
           ARRAY(SELECT unnest(d.datacl::text[]) ORDER BY 1) AS acl,
           (SELECT s.setconfig FROM pg_db_role_setting s
            WHERE s.setdatabase = d.oid AND s.setrole = 0) AS settings
         FROM pg_database d WHERE d.datname = $1`,
        [names.databaseName],
      );
      const roles = await admin.query<Row>(
        `SELECT r.rolname AS name, r.rolcanlogin AS login, r.rolconnlimit AS "connectionLimit",
           r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls AS "elevated",
           r.rolconfig AS config, a.rolpassword LIKE 'SCRAM-SHA-256$4096:%' AS "scramVerifier",
           encode(sha256(convert_to(a.rolpassword, 'UTF8')), 'hex') AS "verifierHash",
           EXISTS (SELECT 1 FROM pg_auth_members m
             WHERE m.roleid = r.oid AND m.member = 'medibooker_provisioner'::regrole
               AND m.admin_option) AS "provisionerIsAdmin",
           EXISTS (SELECT 1 FROM pg_auth_members m
             WHERE m.roleid = r.oid AND m.inherit_option) AS "inheritedByAnyone"
         FROM pg_roles r JOIN pg_authid a ON a.oid = r.oid
         WHERE r.rolname = ANY($1) ORDER BY r.rolname`,
        [[names.appRole, names.ownerRole]],
      );
      return { database: database.rows[0], roles: roles.rows };
    });
    const registry = await withClient(platformOwnerUrl, async (platform) => {
      const result = await platform.query<Row>(
        `SELECT status, market, cluster_id AS "clusterId", database_name AS "databaseName",
           app_secret_ref AS "appSecretRef", owner_secret_ref AS "ownerSecretRef",
           schema_version AS "schemaVersion", migration_error_code AS "migrationErrorCode",
           row_to_json(p)::text AS "row"
         FROM practices p WHERE id = $1`,
        [id],
      );
      return result.rows[0];
    });
    const content =
      catalog.database === undefined
        ? undefined
        : await withClient(superuserUrl(names.databaseName), async (practice) => {
            const migrations = await practice.query<Row>(
              `SELECT migration_name AS name, finished_at IS NOT NULL AS finished
               FROM _prisma_migrations ORDER BY migration_name`,
            );
            const identity = await practice.query<Row>(
              'SELECT id, practice_id FROM practice_identity',
            );
            return { migrations: migrations.rows, identity: identity.rows };
          });
    return { ...catalog, registry, content };
  }

  /** The platform audit rows of a practice, oldest first (ADR 0005 §5.2). */
  async function auditEvents(id: string): Promise<unknown[]> {
    return withClient(platformOwnerUrl, async (platform) => {
      const result = await platform.query<Row>(
        `SELECT action, outcome, error_code AS "errorCode" FROM platform_audit_events
         WHERE practice_id = $1 ORDER BY occurred_at, id`,
        [id],
      );
      return result.rows;
    });
  }

  function provisioned(outcome: 'SUCCEEDED' | 'STARTED'): unknown {
    return { action: 'medibooker-db.provision', outcome, errorCode: null };
  }

  beforeAll(async () => {
    // The platform migrations on the database 01-cluster.sh created, as platform_owner.
    const run = await medibookerDb(['migrate', 'platform']);
    if (run.exitCode !== 0) {
      // The JSON lines carry error codes only (02 §6).
      const codes = run.lines.map((line) => String(line.errorCode)).join(', ');
      throw new Error(`migrate platform failed on medibooker_platform: ${codes}`);
    }
  });

  afterAll(async () => {
    for (const id of [practiceId, stoppedPracticeId]) {
      await dropPractice({
        practiceId: id,
        appEnv: 'ci',
        platformUrl: platformOwnerUrl,
        adminUrl: superuserUrl(),
      });
    }
  });

  it('ADR-0005 §5.3 provision creates practice_<id32>, both roles and an ACTIVE registry entry as medibooker_provisioner', async () => {
    const names = practiceNames(practiceId);
    const run = await medibookerDb(['provision', practiceId, '--market', 'SA']);
    expect(run.exitCode).toBe(0);
    expect(run.lines).toEqual([
      expect.objectContaining({
        practiceId,
        from: null,
        to: NEWEST_PRACTICE_MIGRATION,
        errorCode: null,
      }),
      expect.objectContaining({ command: 'provision', practices: 1, failed: 0, errorCode: null }),
    ]);

    const state = await practiceState(practiceId);
    expect(state.database).toMatchObject({
      localeProvider: 'b',
      locale: 'C.UTF-8',
      encoding: 'UTF8',
      owner: names.ownerRole,
      acl: [`${names.appRole}=c/${names.ownerRole}`, `${names.ownerRole}=CTc/${names.ownerRole}`],
      settings: [`medibooker.app_role=${names.appRole}`],
    });
    // Roles a superuser created would have no ADMIN membership of the provisioner (PostgreSQL 16+).
    const role = { login: true, elevated: false, scramVerifier: true, provisionerIsAdmin: true };
    expect(state.roles).toMatchObject([
      {
        ...role,
        name: names.appRole,
        connectionLimit: DEFAULT_CONNECTION_LIMITS.app,
        config: ['statement_timeout=15s', 'idle_in_transaction_session_timeout=30s'],
        inheritedByAnyone: false,
      },
      {
        ...role,
        name: names.ownerRole,
        connectionLimit: DEFAULT_CONNECTION_LIMITS.owner,
        config: null,
        inheritedByAnyone: false,
      },
    ]);
    expect(state.registry).toMatchObject({
      status: 'ACTIVE',
      market: 'SA',
      clusterId: 'local',
      databaseName: names.databaseName,
      appSecretRef: names.appSecretRef,
      ownerSecretRef: names.ownerSecretRef,
      schemaVersion: NEWEST_PRACTICE_MIGRATION,
      migrationErrorCode: null,
    });
    expect(state.content).toEqual({
      migrations: [{ name: NEWEST_PRACTICE_MIGRATION, finished: true }],
      identity: [{ id: 1, practice_id: practiceId }],
    });
    expect(await auditEvents(practiceId)).toEqual([
      provisioned('STARTED'),
      provisioned('SUCCEEDED'),
    ]);
  });

  it('ADR-0005 §5.3 a second run changes nothing and is audited again', async () => {
    const before = await practiceState(practiceId);
    const run = await medibookerDb(['provision', practiceId, '--market', 'SA']);
    expect(run.exitCode).toBe(0);
    expect(await practiceState(practiceId)).toEqual(before);
    expect(await auditEvents(practiceId)).toEqual([
      provisioned('STARTED'),
      provisioned('SUCCEEDED'),
      provisioned('STARTED'),
      provisioned('SUCCEEDED'),
    ]);
  });

  it('ADR-0005 §5.3 a run stopped after the role step completes on the next run', async () => {
    const names = practiceNames(stoppedPracticeId);
    await expect(
      provisionPractice({
        practiceId: stoppedPracticeId,
        market: 'DE',
        appEnv: 'ci',
        platformUrl: platformOwnerUrl,
        provisionerUrl,
        secretStore: createDevSecretStore({
          appEnv: 'ci',
          seed: cluster.secrets.DEV_SECRET_SEED,
          environment: { PROVISIONER_DATABASE_URL: provisionerUrl },
        }),
        stopAfter: 'roles',
      }),
    ).rejects.toMatchObject({ code: 'PROVISIONING_STOPPED' });
    const stopped = await practiceState(stoppedPracticeId);
    expect(stopped.database).toBeUndefined();
    expect(stopped.roles).toMatchObject([{ name: names.appRole }, { name: names.ownerRole }]);
    expect(stopped.registry).toMatchObject({ status: 'PROVISIONING', schemaVersion: null });

    const run = await medibookerDb(['provision', stoppedPracticeId, '--market', 'DE']);
    expect(run.exitCode).toBe(0);
    const completed = await practiceState(stoppedPracticeId);
    expect(completed.database).toMatchObject({ localeProvider: 'b', locale: 'C.UTF-8' });
    expect(completed.registry).toMatchObject({
      status: 'ACTIVE',
      schemaVersion: NEWEST_PRACTICE_MIGRATION,
      migrationErrorCode: null,
    });
    expect(completed.content).toEqual({
      migrations: [{ name: NEWEST_PRACTICE_MIGRATION, finished: true }],
      identity: [{ id: 1, practice_id: stoppedPracticeId }],
    });
    expect(await auditEvents(stoppedPracticeId)).toEqual([
      provisioned('STARTED'),
      { action: 'medibooker-db.provision', outcome: 'FAILED', errorCode: 'PROVISIONING_STOPPED' },
      provisioned('STARTED'),
      provisioned('SUCCEEDED'),
    ]);
  });

  it('ADR-0005 §4.6 neither the server log nor the CLI output holds a password, host or connection string', async () => {
    const secrets = generatedSecrets(cluster.secrets, [practiceId, stoppedPracticeId]);
    for (const run of runs) {
      expect(forbiddenIn(run.stdout + run.stderr, cluster.host, secrets)).toEqual([]);
      expect(run.stderr).toBe('');
    }
    // The control: the server logged provisioning's statements, the verifier instead of a password.
    const { ownerRole } = practiceNames(practiceId);
    const createRole = `CREATE ROLE "${ownerRole}" LOGIN PASSWORD 'SCRAM-SHA-256$4096:`;
    await expect
      .poll(async () => (await readServerLog()).includes(createRole), { timeout: 10_000 })
      .toBe(true);
    expect(secretNamesIn(await readServerLog(), secrets)).toEqual([]);
  });
});

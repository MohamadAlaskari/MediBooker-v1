/**
 * The migration runner `medibooker-db migrate practices` and `verify` (ADR 0005 §6, §11.8),
 * run as the CLI on practices provisioned on the full path. Fixture migrations live in a
 * temporary PRISMA_ROOT and never reach the repository; each one is atomic like every real
 * migration (ADR 0005 §6.3).
 */
import type { ProvisionedPractice } from '@medibooker/db-migrate/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { usePracticeDatabases } from '../../support/practices.js';
import { runMedibookerDb, type CliRun } from '../support/medibooker-db.js';
import {
  atomicMigration,
  createFixturePrismaRoot,
  type FixturePrismaRoot,
} from '../support/prisma-root.js';
import { forbiddenIn, generatedSecrets } from '../support/secrets.js';
import { connect, withClient } from '../support/sql.js';

const WIDGETS = '29990101000000_fixture_widgets';
const GADGETS = '29990102000000_fixture_gadgets';
const LOCKED = '29990103000000_fixture_widget_notes';

describe('the migration runner (ADR 0005 §6)', () => {
  const databases = usePracticeDatabases({ practices: 'full' });
  const cluster = inject('integrationCluster');
  /** Practices of this file beyond A and B, whose passwords the output must not contain either. */
  const otherPracticeIds: string[] = [];
  let prismaRoot: FixturePrismaRoot;

  beforeAll(() => {
    prismaRoot = createFixturePrismaRoot();
  });

  afterAll(() => {
    prismaRoot.dispose();
  });

  /** `medibooker-db <args>` on this file's platform database, with the fixture PRISMA_ROOT. */
  async function medibookerDb(
    args: readonly string[],
    variables: Readonly<Record<string, string>> = {},
  ): Promise<CliRun> {
    const run = await runMedibookerDb(args, {
      PLATFORM_MIGRATION_URL: databases.platformOwnerUrl,
      SECRET_STORE: 'dev',
      DEV_SECRET_SEED: cluster.secrets.DEV_SECRET_SEED,
      PRISMA_ROOT: prismaRoot.path,
      ...variables,
    });
    // 02 §6: JSON lines only, never a password, host or connection string.
    const practiceIds = [
      databases.practiceA.practiceId,
      databases.practiceB.practiceId,
      ...otherPracticeIds,
    ];
    const secrets = generatedSecrets(cluster.secrets, practiceIds);
    expect(forbiddenIn(run.stdout + run.stderr, cluster.host, secrets)).toEqual([]);
    expect(run.stderr).toBe('');
    return run;
  }

  /** The registry's view of a practice. */
  async function registryEntry(
    practice: ProvisionedPractice,
  ): Promise<{ schemaVersion: string | null; migrationErrorCode: string | null }> {
    return withClient(databases.platformOwnerUrl, async (platform) => {
      const result = await platform.query<{
        schemaVersion: string | null;
        migrationErrorCode: string | null;
      }>(
        `SELECT schema_version AS "schemaVersion", migration_error_code AS "migrationErrorCode"
         FROM practices WHERE id = $1`,
        [practice.practiceId],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('practice not registered');
      return row;
    });
  }

  /** The attempts at one migration in a practice database, in order. */
  async function attempts(
    practice: ProvisionedPractice,
    migration: string,
  ): Promise<{ finished: boolean; rolledBack: boolean }[]> {
    return withClient(databases.superuserUrl(practice.databaseName), async (admin) => {
      const result = await admin.query<{ finished: boolean; rolledBack: boolean }>(
        `SELECT finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS "rolledBack"
         FROM _prisma_migrations WHERE migration_name = $1 ORDER BY started_at`,
        [migration],
      );
      return result.rows;
    });
  }

  /** Runs one statement as the practice's owner role, the role every migration runs as. */
  async function asOwner(practice: ProvisionedPractice, sql: string): Promise<void> {
    const owner = await practice.connectAsOwner();
    try {
      await owner.query(sql);
    } finally {
      await owner.end();
    }
  }

  /** How many attempts at a migration failed and were marked rolled back by the runner. */
  async function rolledBackAttempts(
    practice: ProvisionedPractice,
    migration: string,
  ): Promise<number> {
    return (await attempts(practice, migration)).filter((attempt) => attempt.rolledBack).length;
  }

  function practiceLine(practice: ProvisionedPractice, line: Record<string, unknown>): unknown {
    return expect.objectContaining({ practiceId: practice.practiceId, ...line });
  }

  it('ADR-0005 §11.8 migrates every practice to the newest migration', async () => {
    const { practiceA, practiceB } = databases;
    prismaRoot.addPracticeMigration(
      WIDGETS,
      atomicMigration(
        'CREATE TABLE fixture_widgets (id integer PRIMARY KEY, label text NOT NULL);',
      ),
    );
    const run = await medibookerDb(['migrate', 'practices']);
    expect(run.exitCode).toBe(0);
    expect(run.lines).toEqual(
      expect.arrayContaining([
        practiceLine(practiceA, { to: WIDGETS, errorCode: null }),
        practiceLine(practiceB, { to: WIDGETS, errorCode: null }),
        expect.objectContaining({ command: 'migrate practices', practices: 2, failed: 0 }),
      ]) as unknown,
    );
    expect(await registryEntry(practiceA)).toEqual({
      schemaVersion: WIDGETS,
      migrationErrorCode: null,
    });
    expect(await registryEntry(practiceB)).toEqual({
      schemaVersion: WIDGETS,
      migrationErrorCode: null,
    });
  });

  it('ADR-0005 §11.8 a migration that fails in B leaves A migrated and B on its previous version, and exits 1', async () => {
    const { practiceA, practiceB } = databases;
    // B's environment differs: a table of that name is in the way (ADR 0005 §6.5).
    await asOwner(practiceB, 'CREATE TABLE fixture_gadgets (id integer)');
    prismaRoot.addPracticeMigration(
      GADGETS,
      atomicMigration(
        'CREATE TABLE fixture_gadgets (id integer PRIMARY KEY, label text NOT NULL);',
      ),
    );
    const run = await medibookerDb(['migrate', 'practices']);
    expect(run.exitCode).toBe(1);
    expect(run.lines).toEqual(
      expect.arrayContaining([
        practiceLine(practiceA, { from: WIDGETS, to: GADGETS, errorCode: null }),
        practiceLine(practiceB, { from: WIDGETS, to: WIDGETS, errorCode: 'MIGRATION_FAILED' }),
        expect.objectContaining({ command: 'migrate practices', practices: 2, failed: 1 }),
      ]) as unknown,
    );
    expect(await registryEntry(practiceA)).toEqual({
      schemaVersion: GADGETS,
      migrationErrorCode: null,
    });
    expect(await registryEntry(practiceB)).toEqual({
      schemaVersion: WIDGETS,
      migrationErrorCode: 'MIGRATION_FAILED',
    });
  });

  it("ADR-0005 §11.8 after the fix the next run resolves B's failed entry and completes B without a manual step", async () => {
    const { practiceB } = databases;
    // The repair of B's environment; the migration itself stays unchanged (ADR 0005 §6.5).
    await asOwner(practiceB, 'DROP TABLE fixture_gadgets');
    const run = await medibookerDb(['migrate', 'practices']);
    expect(run.exitCode).toBe(0);
    expect(run.lines).toEqual([
      practiceLine(practiceB, { from: WIDGETS, to: GADGETS, errorCode: null }),
      expect.objectContaining({ command: 'migrate practices', practices: 1, failed: 0 }),
    ]);
    expect(await registryEntry(practiceB)).toEqual({
      schemaVersion: GADGETS,
      migrationErrorCode: null,
    });
    // The failed attempt was marked rolled back by the runner, then the migration applied.
    expect(await attempts(practiceB, GADGETS)).toEqual([
      { finished: false, rolledBack: true },
      { finished: true, rolledBack: false },
    ]);
  });

  it('ADR-0005 §6.4 a migration waiting for a lock fails with lock_not_available and succeeds on a retry once the lock is released', async () => {
    const { practiceB } = databases;
    prismaRoot.addPracticeMigration(
      LOCKED,
      atomicMigration('ALTER TABLE fixture_widgets ADD COLUMN note text;'),
    );
    const migrateB = ['migrate', 'practices', '--practice', practiceB.practiceId];
    // A transaction of the test holds a lock that ALTER TABLE waits for.
    const holder = await connect(databases.superuserUrl(practiceB.databaseName));
    let withRetries: Promise<CliRun> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE fixture_widgets IN ACCESS SHARE MODE');

      const withoutRetry = await medibookerDb(migrateB, { MIGRATION_LOCK_RETRIES: '0' });
      expect(withoutRetry.exitCode).toBe(1);
      expect(withoutRetry.lines[0]).toEqual(
        practiceLine(practiceB, { to: GADGETS, errorCode: 'MIGRATION_LOCK_NOT_AVAILABLE' }),
      );
      expect(await registryEntry(practiceB)).toEqual({
        schemaVersion: GADGETS,
        migrationErrorCode: 'MIGRATION_LOCK_NOT_AVAILABLE',
      });

      withRetries = medibookerDb(migrateB, { MIGRATION_LOCK_RETRIES: '3' });
      // The first attempt of this run waits for the lock, fails and is marked rolled back; only
      // then is the lock released.
      await expect
        .poll(() => rolledBackAttempts(practiceB, LOCKED), { timeout: 60_000, interval: 250 })
        .toBe(2);
      await holder.query('ROLLBACK');
      const run = await withRetries;
      expect(run.exitCode).toBe(0);
      expect(run.lines[0]).toEqual(practiceLine(practiceB, { to: LOCKED, errorCode: null }));
      expect(await attempts(practiceB, LOCKED)).toEqual([
        { finished: false, rolledBack: true },
        { finished: false, rolledBack: true },
        { finished: true, rolledBack: false },
      ]);
      expect(await registryEntry(practiceB)).toEqual({
        schemaVersion: LOCKED,
        migrationErrorCode: null,
      });
    } finally {
      await holder.end();
      // After a failed assertion the CLI may still run: it ends before the file's teardown.
      await withRetries?.catch(() => undefined);
    }
  });

  it('ADR-0005 §6.7 verify exits 0 for a current practice and 2 after a practice table is altered by hand', async () => {
    // A practice at the repository's own schema: verify compares with its schema.prisma.
    const practice = await databases.provision({ path: 'full' });
    otherPracticeIds.push(practice.practiceId);
    const verify = ['verify', '--practice', practice.practiceId];
    // A blank PRISMA_ROOT counts as unset: the repository's apps/api.
    const repositorySchema = { PRISMA_ROOT: '' };
    const clean = await medibookerDb(verify, repositorySchema);
    expect(clean.exitCode).toBe(0);
    expect(clean.lines[0]).toEqual(practiceLine(practice, { errorCode: null }));

    await asOwner(practice, 'ALTER TABLE practice_identity ADD COLUMN note text');
    const drifted = await medibookerDb(verify, repositorySchema);
    expect(drifted.exitCode).toBe(2);
    expect(drifted.lines[0]).toEqual(practiceLine(practice, { errorCode: 'SCHEMA_DRIFT' }));
  });
});

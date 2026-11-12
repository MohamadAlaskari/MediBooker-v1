/**
 * `medibooker-db practice create` (A04): the practice of a new installation in one command, with
 * its address name and its names, provisioned as `provision` does and left unpublished. A rerun
 * after a crash completes it; a name another practice has or had stays with that practice.
 */
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CONNECTION_LIMITS,
  DEFAULT_MIGRATION_LOCK_RETRIES,
  DEFAULT_MIGRATION_TIMEOUT_MS,
  DEFAULT_PRISMA_ROOT,
  practiceCreate,
  type OutputLine,
  type PracticeCreateOptions,
} from '@medibooker/db-migrate';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { usePracticeDatabases } from '../support/practices.js';
import { withClient, type Row } from './support/sql.js';

const NAMES = { ar: 'عيادة الشفاء', en: 'Al Shifa Clinic' };

describe('medibooker-db practice create (A04)', () => {
  const databases = usePracticeDatabases({ practices: 'none' });

  /** Options for one run; every practice a run names is dropped at teardown. */
  function options(
    slug: string,
    lines: OutputLine[],
    overrides: Partial<PracticeCreateOptions> = {},
  ): PracticeCreateOptions {
    return {
      appEnv: 'ci',
      platformUrl: databases.platformOwnerUrl,
      actor: 'local:practice-create-test',
      output: { write: (line) => lines.push(line) },
      secretStore: databases.secretStore,
      prismaRoot: DEFAULT_PRISMA_ROOT,
      clusterEndpoints: new Map(),
      provisionerUrl: databases.provisionerUrl,
      markets: undefined,
      connectionLimits: DEFAULT_CONNECTION_LIMITS,
      migrationTimeoutMs: DEFAULT_MIGRATION_TIMEOUT_MS,
      migrationLockRetries: DEFAULT_MIGRATION_LOCK_RETRIES,
      slug,
      names: NAMES,
      market: 'SA',
      clusterId: undefined,
      timeZone: 'Asia/Riyadh',
      defaultLocale: 'ar',
      newPracticeId: () => {
        const id = randomUUID();
        databases.dropOnTeardown(id);
        return id;
      },
      ...overrides,
    };
  }

  function platform<T>(work: (client: Client) => Promise<T>): Promise<T> {
    return withClient(databases.platformOwnerUrl, work);
  }

  async function registryOf(slug: string): Promise<Row[]> {
    return platform(async (client) => {
      const result = await client.query<Row>(
        `SELECT p.id, p.status, p.market, p.name, p.published_at AS "publishedAt",
           s.retired_at AS "retiredAt"
         FROM practice_slugs s JOIN practices p ON p.id = s.practice_id WHERE s.slug = $1`,
        [slug],
      );
      return result.rows;
    });
  }

  /** The audit rows of one actor: practice create's without a practice, provision's with one. */
  async function auditOf(actor: string): Promise<Row[]> {
    return platform(async (client) => {
      const rows = await client.query<Row>(
        `SELECT action, outcome, error_code AS "errorCode", practice_id AS "practiceId"
         FROM platform_audit_events WHERE actor = $1`,
        [actor],
      );
      return rows.rows;
    });
  }

  it('creates the practice with its address name, its names and its settings, unpublished and audited', async () => {
    const lines: OutputLine[] = [];
    const result = await practiceCreate(
      options('al-shifa', lines, { actor: 'local:create-al-shifa' }),
    );

    expect(result.errorCode).toBeNull();
    expect(result.exitCode).toBe(0);
    const practiceId = result.practiceId;
    expect(practiceId).toBeDefined();
    expect(await registryOf('al-shifa')).toEqual([
      {
        id: practiceId,
        status: 'ACTIVE',
        market: 'SA',
        name: NAMES,
        publishedAt: null,
        retiredAt: null,
      },
    ]);
    if (result.practice === undefined) throw new Error('no practice');
    const app = await databases.connectAsApp(result.practice);
    try {
      const settings = await app.query<Row>(
        'SELECT time_zone AS "timeZone", default_locale AS "defaultLocale" FROM practice_settings',
      );
      expect(settings.rows).toEqual([{ timeZone: 'Asia/Riyadh', defaultLocale: 'ar' }]);
    } finally {
      await app.end();
    }
    // One pair for the whole command, without a practice; provision names it.
    expect(await auditOf('local:create-al-shifa')).toEqual(
      expect.arrayContaining([
        {
          action: 'medibooker-db.practice.create',
          outcome: 'STARTED',
          errorCode: null,
          practiceId: null,
        },
        {
          action: 'medibooker-db.practice.create',
          outcome: 'SUCCEEDED',
          errorCode: null,
          practiceId: null,
        },
        { action: 'medibooker-db.provision', outcome: 'SUCCEEDED', errorCode: null, practiceId },
      ]),
    );
    expect(lines.at(-1)).toMatchObject({
      command: 'practice create',
      practices: 1,
      failed: 0,
      errorCode: null,
      practiceId,
      slug: 'al-shifa',
    });
  });

  it('changes nothing when run again for a practice that exists: PRACTICE_EXISTS', async () => {
    await practiceCreate(options('al-amal', []));
    const before = await registryOf('al-amal');

    const lines: OutputLine[] = [];
    const again = await practiceCreate(
      options('al-amal', lines, {
        names: { ar: 'اسم آخر', en: 'Another name' },
        actor: 'local:again-al-amal',
      }),
    );

    expect(again).toMatchObject({ exitCode: 1, errorCode: 'PRACTICE_EXISTS' });
    expect(await registryOf('al-amal')).toEqual(before);
    expect(lines.at(-1)).toMatchObject({
      command: 'practice create',
      errorCode: 'PRACTICE_EXISTS',
    });
    // A refusal is audited too, and nothing is provisioned.
    const refused = await auditOf('local:again-al-amal');
    expect(refused).toHaveLength(2);
    expect(refused).toEqual(
      expect.arrayContaining([
        {
          action: 'medibooker-db.practice.create',
          outcome: 'STARTED',
          errorCode: null,
          practiceId: null,
        },
        {
          action: 'medibooker-db.practice.create',
          outcome: 'FAILED',
          errorCode: 'PRACTICE_EXISTS',
          practiceId: null,
        },
      ]),
    );
  });

  it.each([
    ['sign-in', 'SLUG_NOT_ALLOWED'],
    ['medibooker', 'SLUG_NOT_ALLOWED'],
    ['Al-Shifa', 'SLUG_NOT_ALLOWED'],
    ['ab', 'SLUG_NOT_ALLOWED'],
  ])('refuses the address name %s before anything is written', async (slug, errorCode) => {
    const result = await practiceCreate(options(slug, []));
    expect(result).toMatchObject({ exitCode: 1, errorCode, practiceId: undefined });
    expect(await registryOf(slug)).toEqual([]);
  });

  it('refuses names that are empty or carry control characters', async () => {
    const result = await practiceCreate(
      options('al-noor-b', [], { names: { ar: ' ', en: 'Line\nbreak' } }),
    );
    expect(result).toMatchObject({ exitCode: 1, errorCode: 'INVALID_ARGUMENTS' });
    expect(await registryOf('al-noor-b')).toEqual([]);
  });

  it('leaves a retired address name with the practice that had it: SLUG_TAKEN', async () => {
    const first = await practiceCreate(options('old-name', []));
    await platform(async (client) => {
      await client.query('UPDATE practice_slugs SET retired_at = now() WHERE slug = $1', [
        'old-name',
      ]);
      await client.query('INSERT INTO practice_slugs (slug, practice_id) VALUES ($1, $2)', [
        'new-name',
        first.practiceId,
      ]);
    });

    const result = await practiceCreate(options('old-name', []));

    expect(result).toMatchObject({ exitCode: 1, errorCode: 'SLUG_TAKEN', practiceId: undefined });
    expect((await registryOf('old-name')).map((row) => row.id)).toEqual([first.practiceId]);
  });

  it('completes a practice an earlier run reserved and did not provision, under the same id', async () => {
    const practiceId = randomUUID();
    databases.dropOnTeardown(practiceId);
    await platform(async (client) => {
      await client.query('INSERT INTO practices (id, market) VALUES ($1, $2)', [practiceId, 'SA']);
      await client.query('INSERT INTO practice_slugs (slug, practice_id) VALUES ($1, $2)', [
        'half-done',
        practiceId,
      ]);
    });

    const result = await practiceCreate(options('half-done', []));

    expect(result).toMatchObject({ exitCode: 0, errorCode: null, practiceId });
    expect(await registryOf('half-done')).toEqual([
      {
        id: practiceId,
        status: 'ACTIVE',
        market: 'SA',
        name: NAMES,
        publishedAt: null,
        retiredAt: null,
      },
    ]);
  });

  it('does not complete a reserved practice of another market: PRACTICE_MARKET_MISMATCH', async () => {
    const practiceId = randomUUID();
    databases.dropOnTeardown(practiceId);
    await platform(async (client) => {
      await client.query('INSERT INTO practices (id, market) VALUES ($1, $2)', [practiceId, 'DE']);
      await client.query('INSERT INTO practice_slugs (slug, practice_id) VALUES ($1, $2)', [
        'other-market',
        practiceId,
      ]);
    });

    const result = await practiceCreate(options('other-market', []));

    expect(result).toMatchObject({ exitCode: 1, errorCode: 'PRACTICE_MARKET_MISMATCH' });
    expect(await registryOf('other-market')).toMatchObject([{ status: 'PROVISIONING' }]);
  });

  it('lets one of two runs at the same moment create the practice', async () => {
    const results = await Promise.all([
      practiceCreate(options('twin-runs', [])),
      practiceCreate(options('twin-runs', [])),
    ]);

    expect(results.filter(({ errorCode }) => errorCode === null)).toHaveLength(1);
    expect(
      results.filter(({ errorCode }) => errorCode !== null).map(({ errorCode }) => errorCode),
    ).toEqual([expect.stringMatching(/^(RUNNER_BUSY|PRACTICE_EXISTS)$/)]);
    expect(await registryOf('twin-runs')).toMatchObject([{ status: 'ACTIVE' }]);
  });

  it('writes nothing without a secret store: SECRET_STORE_UNAVAILABLE', async () => {
    const result = await practiceCreate(options('no-secrets', [], { secretStore: undefined }));

    expect(result).toMatchObject({ exitCode: 1, errorCode: 'SECRET_STORE_UNAVAILABLE' });
    expect(await registryOf('no-secrets')).toEqual([]);
  });
});

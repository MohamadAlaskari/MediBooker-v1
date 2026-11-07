/**
 * The seed (02 §9, 08 F04): `al-noor` and `lindenhof` with fixed ids, provisioned on the full
 * path, and practice_template. Deterministic and idempotent: a second run changes no row count.
 * The seed practices' database names are fixed, so only this file provisions them.
 */
import { practiceNames } from '@medibooker/db-migrate';
import { describe, expect, it } from 'vitest';
import { seed, SEED_PRACTICES, type SeedOptions } from '../../prisma/seed.js';
import { usePracticeDatabases } from '../support/practices.js';
import { rowCounts, withClient, type Row } from './support/sql.js';

describe('the seed (08 F04)', () => {
  const databases = usePracticeDatabases({ practices: 'none' });
  for (const practice of SEED_PRACTICES) databases.dropOnTeardown(practice.id);

  /** Row counts of every table: the file's platform database and both seed practice databases. */
  async function allRowCounts(): Promise<Record<string, Record<string, number>>> {
    const counts: Record<string, Record<string, number>> = {
      platform: await rowCounts(databases.platformOwnerUrl),
    };
    for (const practice of SEED_PRACTICES) {
      const { databaseName } = practiceNames(practice.id);
      counts[practice.slug] = await rowCounts(databases.superuserUrl(databaseName));
    }
    return counts;
  }

  /** What only people fill, at run time: the seed adds no patient and nothing they cause. */
  const FILLED_AT_RUN_TIME: ReadonlySet<string> = new Set([
    'patients',
    'integration_outbox',
    'audit_events',
  ]);

  /** P01: every other practice table has rows, and the registry names and publishes the practice. */
  async function expectPublishedAndFilled(): Promise<void> {
    const listings = await withClient(databases.platformOwnerUrl, async (platform) => {
      const result = await platform.query<Row>(
        `SELECT id, name, published_at IS NOT NULL AS published FROM practices ORDER BY id`,
      );
      return result.rows;
    });
    expect(listings).toEqual(SEED_PRACTICES.map(({ id, name }) => ({ id, name, published: true })));
    for (const practice of SEED_PRACTICES) {
      const { databaseName } = practiceNames(practice.id);
      const counts = await rowCounts(databases.superuserUrl(databaseName));
      expect(
        Object.entries(counts).filter(
          ([table, count]) => count === 0 && !FILLED_AT_RUN_TIME.has(table),
        ),
      ).toEqual([]);
      const settings = await withClient(databases.superuserUrl(databaseName), async (client) => {
        const result = await client.query<Row>(
          'SELECT time_zone AS "timeZone", default_locale AS "defaultLocale" FROM practice_settings',
        );
        return result.rows;
      });
      expect(settings).toEqual([
        { timeZone: practice.timeZone, defaultLocale: practice.defaultLocale },
      ]);
    }
  }

  it('08 F04 leaves every row count unchanged when it runs a second time', async () => {
    const options: SeedOptions = {
      appEnv: 'ci',
      platformUrl: databases.platformOwnerUrl,
      provisionerUrl: databases.provisionerUrl,
      adminUrl: databases.superuserUrl(),
      secretStore: databases.secretStore,
    };
    // The global setup built a current practice_template, so the seed leaves it as it is.
    expect(await seed(options)).toEqual({ provisioned: 2, templateRefreshed: false });
    const registered = await withClient(databases.platformOwnerUrl, async (platform) => {
      const result = await platform.query<Row>(
        `SELECT s.slug, s.practice_id AS "practiceId", p.status, p.market
         FROM practice_slugs s JOIN practices p ON p.id = s.practice_id ORDER BY s.slug`,
      );
      return result.rows;
    });
    expect(registered).toEqual(
      SEED_PRACTICES.map(({ id, slug, market }) => ({
        slug,
        practiceId: id,
        status: 'ACTIVE',
        market,
      })),
    );
    await expectPublishedAndFilled();
    const afterFirstRun = await allRowCounts();

    expect(await seed(options)).toEqual({ provisioned: 0, templateRefreshed: false });
    expect(await allRowCounts()).toEqual(afterFirstRun);
  });
});

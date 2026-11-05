/**
 * The constraints of the platform schema on practice slugs (08 F04, ADR 0005 §1.1): current and
 * retired slugs share one uniqueness space, and a practice has at most one current slug. Written
 * as platform_app, the API's role, which may change slugs (P02).
 */
import { describe, expect, it } from 'vitest';
import { usePracticeDatabases } from '../support/practices.js';
import { statementOutcome, withClient, type Outcome } from './support/sql.js';

describe('practice slugs in the platform database (08 F04)', () => {
  const databases = usePracticeDatabases();

  function asPlatformApp(sql: string, values: readonly unknown[]): Promise<Outcome> {
    return withClient(databases.platformAppUrl, (client) => statementOutcome(client, sql, values));
  }

  function insertSlug(slug: string, practiceId: string): Promise<Outcome> {
    return asPlatformApp('INSERT INTO practice_slugs (slug, practice_id) VALUES ($1, $2)', [
      slug,
      practiceId,
    ]);
  }

  it('08 F04 rejects the slug "Al Noor" with the CHECK and accepts "al-noor"', async () => {
    const { practiceId } = databases.practiceA;
    expect(await insertSlug('Al Noor', practiceId)).toEqual({
      code: '23514',
      message: expect.stringContaining('practice_slugs_slug_check') as unknown,
    });
    expect(await insertSlug('al-noor', practiceId)).toBe('succeeded');
  });

  it('08 F04 rejects a second current slug for one practice', async () => {
    const { practiceId } = databases.practiceB;
    expect(await insertSlug('lindenhof', practiceId)).toBe('succeeded');
    expect(await insertSlug('lindenhof-berlin', practiceId)).toEqual({
      code: '23505',
      message: expect.stringContaining('practice_slugs_current_practice_id_key') as unknown,
    });
  });

  it('08 F04 keeps a retired slug of practice A from being inserted for practice B', async () => {
    const practiceA = await databases.provision();
    const practiceB = await databases.provision();
    expect(await insertSlug('al-shifa', practiceA.practiceId)).toBe('succeeded');
    expect(
      await asPlatformApp('UPDATE practice_slugs SET retired_at = now() WHERE slug = $1', [
        'al-shifa',
      ]),
    ).toBe('succeeded');
    // A retired slug no longer counts as current: A may take a new one.
    expect(await insertSlug('al-shifa-riyadh', practiceA.practiceId)).toBe('succeeded');
    expect(await insertSlug('al-shifa', practiceB.practiceId)).toEqual({
      code: '23505',
      message: expect.stringContaining('practice_slugs_pkey') as unknown,
    });
  });
});

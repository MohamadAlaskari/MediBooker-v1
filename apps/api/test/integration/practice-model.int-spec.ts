/**
 * The practice model in a real practice database (08 P01): the constraints that Prisma's schema
 * cannot express, provisioning as the practice owner, and the API's narrow right on the registry.
 */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usePracticeDatabases } from '../support/practices.js';
import { statementOutcome, type Outcome, type Row, withClient } from './support/sql.js';

/** SQLSTATEs of the constraints. */
const CHECK_VIOLATION = '23514';
const EXCLUSION_VIOLATION = '23P01';
const UNIQUE_VIOLATION = '23505';
const RESTRICT_VIOLATION = '23001';
const INSUFFICIENT_PRIVILEGE = '42501';

function codeOf(outcome: Outcome): string | undefined {
  return outcome === 'succeeded' ? undefined : outcome.code;
}

describe('the practice model (08 P01)', () => {
  const databases = usePracticeDatabases();
  let owner: Client;

  beforeAll(async () => {
    owner = await databases.practiceA.connectAsOwner();
  });

  afterAll(async () => {
    await owner.end();
  });

  const openingHours = (weekday: number, opensAt: number, closesAt: number): Promise<Outcome> =>
    statementOutcome(
      owner,
      'INSERT INTO opening_hours (weekday, opens_at, closes_at) VALUES ($1, $2, $3)',
      [weekday, opensAt, closesAt],
    );

  it('rejects an overlapping opening interval on one weekday, and accepts a touching one', async () => {
    expect(await openingHours(1, 540, 780)).toBe('succeeded');
    expect(codeOf(await openingHours(1, 700, 800))).toBe(EXCLUSION_VIOLATION);
    expect(await openingHours(1, 780, 900)).toBe('succeeded');
    expect(await openingHours(2, 700, 800)).toBe('succeeded');
  });

  it.each([
    [0, 540, 780],
    [8, 540, 780],
    [3, 780, 540],
    [3, 540, 1441],
  ])('rejects the interval weekday %i, %i to %i', async (weekday, opensAt, closesAt) => {
    expect(codeOf(await openingHours(weekday, opensAt, closesAt))).toBe(CHECK_VIOLATION);
  });

  it('has one row of each singleton, which the migration inserted', async () => {
    for (const table of ['practice_settings', 'practice_pages', 'practice_themes']) {
      const { rows } = await owner.query<Row>(`SELECT id FROM ${table}`);
      expect(rows).toEqual([{ id: 1 }]);
      expect(codeOf(await statementOutcome(owner, `INSERT INTO ${table} (id) VALUES (1)`))).toBe(
        UNIQUE_VIOLATION,
      );
      expect(codeOf(await statementOutcome(owner, `INSERT INTO ${table} (id) VALUES (2)`))).toBe(
        CHECK_VIOLATION,
      );
    }
  });

  it.each([
    ['week_start = 8'],
    ['weekend_days = ARRAY[9]::SMALLINT[]'],
    ["numbering_system = 'roman'"],
    ["hour_cycle = 'h24'"],
    ["default_locale = 'de'"],
    ['address = \'"Riyadh"\''],
    ['max_horizon_days = 0'],
  ])('rejects the settings value %s', async (assignment) => {
    expect(
      codeOf(await statementOutcome(owner, `UPDATE practice_settings SET ${assignment}`)),
    ).toBe(CHECK_VIOLATION);
  });

  it.each([4, 481])('rejects a service of %i minutes', async (durationMinutes) => {
    expect(
      codeOf(
        await statementOutcome(
          owner,
          `INSERT INTO services (name, duration_minutes) VALUES ('{"en":"Check-up"}', $1)`,
          [durationMinutes],
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('rejects a locale text that is not an object', async () => {
    expect(
      codeOf(
        await statementOutcome(
          owner,
          `INSERT INTO services (name, duration_minutes) VALUES ('"Check-up"', 30)`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('rejects a duplicate special day and one that is neither closed nor has valid hours', async () => {
    const insert = (date: string, closed: boolean, opensAt: number | null): Promise<Outcome> =>
      statementOutcome(
        owner,
        'INSERT INTO special_days (date, closed, opens_at, closes_at) VALUES ($1, $2, $3, $4)',
        [date, closed, opensAt, opensAt === null ? null : opensAt + 60],
      );
    expect(await insert('2026-12-24', true, null)).toBe('succeeded');
    expect(codeOf(await insert('2026-12-24', true, null))).toBe(UNIQUE_VIOLATION);
    expect(codeOf(await insert('2026-12-25', false, null))).toBe(CHECK_VIOLATION);
    expect(codeOf(await insert('2026-12-26', true, 540))).toBe(CHECK_VIOLATION);
    expect(await insert('2026-12-27', false, 540)).toBe('succeeded');
  });

  it.each([
    ['an invalid colour', 'CUSTOM', '#GGGGGG', Array.from({ length: 11 }, () => '#0a0b0c')],
    [
      'a colour that breaks out of CSS',
      'CUSTOM',
      '#000;}',
      Array.from({ length: 11 }, () => '#0a0b0c'),
    ],
    ['a scale of 10 items', 'CUSTOM', '#0a0b0c', Array.from({ length: 10 }, () => '#0a0b0c')],
    [
      'a scale item that breaks out of CSS',
      'CUSTOM',
      '#0a0b0c',
      ['#000;}', ...Array.from({ length: 10 }, () => '#0a0b0c')],
    ],
    ['a custom colour with a preset', 'TEAL', '#0a0b0c', []],
    ['the preset CUSTOM without a colour', 'CUSTOM', null, []],
    ['the preset CUSTOM without a scale', 'CUSTOM', '#0a0b0c', []],
  ])('rejects a theme with %s', async (_case, preset, customColor, scale) => {
    expect(
      codeOf(
        await statementOutcome(
          owner,
          'UPDATE practice_themes SET preset = $1::theme_preset, custom_color = $2, scale = $3',
          [preset, customColor, scale],
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('accepts a valid custom theme and rejects three initials', async () => {
    expect(
      await statementOutcome(
        owner,
        `UPDATE practice_themes SET preset = 'CUSTOM', custom_color = $1, scale = $2`,
        ['#0a0b0c', Array.from({ length: 11 }, () => '#0a0b0c')],
      ),
    ).toBe('succeeded');
    expect(
      codeOf(await statementOutcome(owner, `UPDATE practice_themes SET initials = 'ABC'`)),
    ).toBe(CHECK_VIOLATION);
  });

  it('allows one active consent of a type, a new one after a withdrawal, and keeps the history', async () => {
    const memberId = randomUUID();
    await owner.query(
      `INSERT INTO staff_members (id, first_name, last_name) VALUES ($1, 'Test', 'Member')`,
      [memberId],
    );
    const consent = (type: string): Promise<Outcome> =>
      statementOutcome(
        owner,
        `INSERT INTO staff_consents (staff_member_id, type, text_version, given_at)
         VALUES ($1, $2::staff_consent_type, 'v1', now())`,
        [memberId, type],
      );
    expect(await consent('PUBLIC_PROFILE')).toBe('succeeded');
    expect(codeOf(await consent('PUBLIC_PROFILE'))).toBe(UNIQUE_VIOLATION);
    expect(await consent('PHOTO')).toBe('succeeded');
    await owner.query(
      `UPDATE staff_consents SET withdrawn_at = now()
       WHERE staff_member_id = $1 AND type = 'PUBLIC_PROFILE'`,
      [memberId],
    );
    expect(await consent('PUBLIC_PROFILE')).toBe('succeeded');
    expect(
      codeOf(await statementOutcome(owner, 'DELETE FROM staff_members WHERE id = $1', [memberId])),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('gives the app role access to the new tables and keeps its identity read-only', async () => {
    const app = await databases.connectAsApp(databases.practiceA);
    try {
      expect(
        await statementOutcome(
          app,
          `INSERT INTO services (name, duration_minutes) VALUES ('{"en":"Check-up"}', 30)`,
        ),
      ).toBe('succeeded');
      expect(codeOf(await statementOutcome(app, 'DELETE FROM practice_identity'))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    } finally {
      await app.end();
    }
  });

  describe('provisioning on the full path, as the practice owner', () => {
    it('creates btree_gist without superuser rights and writes the time zone and locale', async () => {
      const practice = await databases.provision({
        path: 'full',
        market: 'DE',
        timeZone: 'Europe/Berlin',
        defaultLocale: 'de',
      });
      const client = await practice.connectAsOwner();
      try {
        const settings = await client.query<Row>(
          `SELECT time_zone AS "timeZone", default_locale AS "defaultLocale",
                  supported_locales AS "supportedLocales" FROM practice_settings`,
        );
        expect(settings.rows).toEqual([
          { timeZone: 'Europe/Berlin', defaultLocale: 'de', supportedLocales: ['ar', 'en', 'de'] },
        ]);
        const extension = await client.query<Row>(
          `SELECT pg_get_userbyid(extowner) AS owner FROM pg_extension WHERE extname = 'btree_gist'`,
        );
        expect(extension.rows).toEqual([{ owner: practice.ownerRole }]);
      } finally {
        await client.end();
      }
    });
  });

  describe('the API on the registry', () => {
    it('may add and retire a slug, and never repoint or delete one', async () => {
      await withClient(databases.platformAppUrl, async (platform) => {
        expect(
          await statementOutcome(
            platform,
            `INSERT INTO practice_slugs (slug, practice_id) VALUES ('registry-test', $1)`,
            [databases.practiceA.practiceId],
          ),
        ).toBe('succeeded');
        expect(
          codeOf(
            await statementOutcome(
              platform,
              `UPDATE practice_slugs SET practice_id = $1 WHERE slug = 'registry-test'`,
              [databases.practiceB.practiceId],
            ),
          ),
        ).toBe(INSUFFICIENT_PRIVILEGE);
        expect(
          codeOf(
            await statementOutcome(
              platform,
              `DELETE FROM practice_slugs WHERE slug = 'registry-test'`,
            ),
          ),
        ).toBe(INSUFFICIENT_PRIVILEGE);
        expect(
          await statementOutcome(
            platform,
            `UPDATE practice_slugs SET retired_at = now() WHERE slug = 'registry-test'`,
          ),
        ).toBe('succeeded');
      });
    });

    it('may change a name and the publication, and nothing that routes or locks a practice', async () => {
      await withClient(databases.platformAppUrl, async (platform) => {
        const id = databases.practiceA.practiceId;
        expect(
          await statementOutcome(
            platform,
            `UPDATE practices SET name = '{"en":"A"}', published_at = now(), updated_at = now()
             WHERE id = $1`,
            [id],
          ),
        ).toBe('succeeded');
        for (const assignment of [
          `status = 'SUSPENDED'`,
          `database_name = 'practice_x'`,
          `app_secret_ref = 'dev:x'`,
        ]) {
          expect(
            codeOf(
              await statementOutcome(platform, `UPDATE practices SET ${assignment} WHERE id = $1`, [
                id,
              ]),
            ),
          ).toBe(INSUFFICIENT_PRIVILEGE);
        }
      });
    });
  });
});

/**
 * GET /api/v1/public/practices/:slug against real databases (08 P02): two practices, each with its
 * own data in its own database. The registry is changed as platform_owner, as medibooker-db does.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fillPractice, SEED_PRACTICES } from '../../prisma/seed-practices.js';
import { PlatformPrismaService } from '../../src/common/database/platform-prisma.service.js';
import { PracticeConnectionManager } from '../../src/common/tenancy/practice-connection-manager.js';
import { PublishedPractices } from '../../src/common/tenancy/published-practices.js';
import { FixedClock } from '../../src/common/time/fixed-clock.js';
import { ENV } from '../../src/config/env.module.js';
import type { Env } from '../../src/config/env.schema.js';
import { createTestApp } from '../support/create-test-app.js';
import { usePracticeDatabases } from '../support/practices.js';
import { problemWithoutRequestId } from '../support/problem.js';
import { keyPathsOf, PUBLIC_PRACTICE_KEY_PATHS } from '../support/public-practice-rows.js';
import { withClient } from './support/sql.js';

const PATH = '/api/v1/public/practices';
const [AL_NOOR, LINDENHOF] = SEED_PRACTICES;

interface PracticeBody {
  slug: string;
  name: string;
  timeZone: string;
  openNow: boolean;
  nextChangeAt: string | null;
  services: { id: string; name: string }[];
  team: { firstName: string }[];
  specialDays: { date: string; closed: boolean }[];
}

describe('GET /api/v1/public/practices/:slug on real databases (08 P02)', () => {
  const databases = usePracticeDatabases({ practices: 'none' });
  // Sunday 2026-11-15, 10:00 in Riyadh.
  const clock = new FixedClock(Temporal.Instant.from('2026-11-15T07:00:00Z'));
  let app: NestExpressApplication;
  let alNoorId: string;

  const inRegistry = async (sql: string, values: unknown[]): Promise<void> => {
    await withClient(databases.platformOwnerUrl, (platform) => platform.query(sql, values));
  };

  const publish = async (practiceId: string, slug: string, name: unknown): Promise<void> => {
    await inRegistry('INSERT INTO practice_slugs (slug, practice_id) VALUES ($1, $2)', [
      slug,
      practiceId,
    ]);
    await inRegistry('UPDATE practices SET name = $2, published_at = now() WHERE id = $1', [
      practiceId,
      name,
    ]);
  };

  const get = (slug: string, language = 'en'): request.Test =>
    request(app.getHttpServer()).get(`${PATH}/${slug}`).set('Accept-Language', language);

  beforeAll(async () => {
    const alNoor = await databases.provision({
      market: AL_NOOR.market,
      timeZone: AL_NOOR.timeZone,
      defaultLocale: AL_NOOR.defaultLocale,
    });
    const lindenhof = await databases.provision({
      market: LINDENHOF.market,
      timeZone: LINDENHOF.timeZone,
      defaultLocale: LINDENHOF.defaultLocale,
    });
    alNoorId = alNoor.practiceId;
    for (const [practice, data] of [
      [alNoor, AL_NOOR.data],
      [lindenhof, LINDENHOF.data],
    ] as const) {
      const owner = await practice.connectAsOwner();
      await fillPractice(owner, data).finally(() => owner.end());
    }
    await publish(alNoor.practiceId, AL_NOOR.slug, AL_NOOR.name);
    await publish(lindenhof.practiceId, LINDENHOF.slug, LINDENHOF.name);
    app = await createTestApp({ env: databases.apiEnv, clock });
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a published practice from its own database, with exactly the allowlisted fields', async () => {
    const response = await get(AL_NOOR.slug).expect(200);
    expect(keyPathsOf(response.body)).toEqual(PUBLIC_PRACTICE_KEY_PATHS);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-language']).toBe('en');
    expect(response.body).toMatchObject({
      slug: AL_NOOR.slug,
      name: AL_NOOR.name.en,
      timeZone: 'Asia/Riyadh',
      openNow: true,
      nextChangeAt: '2026-11-15T10:00:00Z',
    });
  });

  it('answers in Arabic when asked', async () => {
    const response = await get(AL_NOOR.slug, 'ar').expect(200);
    expect(response.headers['content-language']).toBe('ar');
    expect((response.body as PracticeBody).name).toBe(AL_NOOR.name.ar);
  });

  it('never shows the services of another practice', async () => {
    const serviceIdsOf = (practice: (typeof SEED_PRACTICES)[number]): string[] =>
      practice.data.services
        .filter((service) => !('isBookableOnline' in service) || service.isBookableOnline)
        .map((service) => service.id);
    const alNoor = (await get(AL_NOOR.slug).expect(200)).body as PracticeBody;
    const lindenhof = (await get(LINDENHOF.slug).expect(200)).body as PracticeBody;
    expect(alNoor.services.map((service) => service.id)).toEqual(serviceIdsOf(AL_NOOR));
    expect(lindenhof.services.map((service) => service.id)).toEqual(serviceIdsOf(LINDENHOF));
    expect(lindenhof.services.map((service) => service.id)).not.toEqual(
      expect.arrayContaining(alNoor.services.map((service) => service.id)),
    );
  });

  it('lists only team members with an active public-profile consent who are not hidden', async () => {
    const alNoor = (await get(AL_NOOR.slug).expect(200)).body as PracticeBody;
    // Withdrawn and without any consent: not listed.
    expect(alNoor.team.map((member) => member.firstName)).toEqual(['سارة']);
    const lindenhof = (await get(LINDENHOF.slug).expect(200)).body as PracticeBody;
    // Consent, but hidden by an admin: not listed.
    expect(lindenhof.team.map((member) => member.firstName)).toEqual(['Anna']);
  });

  it('computes open now from the practice data and shows special days of the next 60 days', async () => {
    clock.set(Temporal.Instant.from('2026-11-19T07:00:00Z'));
    const closure = (await get(AL_NOOR.slug).expect(200)).body as PracticeBody;
    expect(closure.openNow).toBe(false);
    expect(closure.specialDays).toContainEqual(
      expect.objectContaining({ date: '2026-11-19', closed: true }),
    );
    clock.set(Temporal.Instant.from('2027-02-01T07:00:00Z'));
    const later = (await get(AL_NOOR.slug).expect(200)).body as PracticeBody;
    expect(later.specialDays).toEqual([]);
    clock.set(Temporal.Instant.from('2026-11-15T07:00:00Z'));
  });

  it('answers one 404 for an unknown, an unpublished and a provisioning slug, and opens no client', async () => {
    const unpublished = await databases.provision();
    await inRegistry('INSERT INTO practice_slugs (slug, practice_id) VALUES ($1, $2)', [
      'not-published',
      unpublished.practiceId,
    ]);
    const provisioning = await databases.provision();
    await inRegistry('INSERT INTO practice_slugs (slug, practice_id) VALUES ($1, $2)', [
      'still-provisioning',
      provisioning.practiceId,
    ]);
    await inRegistry(
      `UPDATE practices SET status = 'PROVISIONING', published_at = now() WHERE id = $1`,
      [provisioning.practiceId],
    );
    const connections = app.get(PracticeConnectionManager);
    const creationsBefore = connections.stats().creations;
    const unknown = await get('no-such-practice').expect(404);
    expect(problemWithoutRequestId(await get('not-published').expect(404))).toEqual(
      problemWithoutRequestId(unknown),
    );
    expect(problemWithoutRequestId(await get('still-provisioning').expect(404))).toEqual(
      problemWithoutRequestId(unknown),
    );
    expect(connections.stats().creations).toBe(creationsBefore);
  });

  it('answers 200 with the current slug for a retired one', async () => {
    await inRegistry(
      `INSERT INTO practice_slugs (slug, practice_id, retired_at) VALUES ('old-al-noor', $1, now())`,
      [alNoorId],
    );
    const response = await get('old-al-noor').expect(200);
    expect((response.body as PracticeBody).slug).toBe(AL_NOOR.slug);
  });

  it('answers 503 with Retry-After for a suspended practice, and serves it again afterwards', async () => {
    await inRegistry(`UPDATE practices SET status = 'SUSPENDED' WHERE id = $1`, [alNoorId]);
    const response = await get(AL_NOOR.slug).expect(503);
    expect(response.headers['retry-after']).toBe('30');
    await inRegistry(`UPDATE practices SET status = 'ACTIVE' WHERE id = $1`, [alNoorId]);
    await get(AL_NOOR.slug).expect(200);
  });

  it('answers 404 at once after a practice is unpublished', async () => {
    await inRegistry('UPDATE practices SET published_at = NULL WHERE id = $1', [alNoorId]);
    expect((await get(AL_NOOR.slug)).status).toBe(404);
    await inRegistry('UPDATE practices SET published_at = now() WHERE id = $1', [alNoorId]);
    expect((await get(AL_NOOR.slug)).status).toBe(200);
  });

  it('hides a team member at once when the consent is withdrawn (BR-24)', async () => {
    const alNoor = databases.superuserUrl(`practice_${alNoorId.replaceAll('-', '')}`);
    await withClient(alNoor, async (client) => {
      await client.query(
        `UPDATE staff_consents SET withdrawn_at = now() WHERE type = 'PUBLIC_PROFILE' AND withdrawn_at IS NULL`,
      );
    });
    const response = (await get(AL_NOOR.slug).expect(200)).body as PracticeBody;
    expect(response.team).toEqual([]);
  });

  describe('GET /api/v1/public/practices', () => {
    const list = (query = ''): request.Test => request(app.getHttpServer()).get(`${PATH}${query}`);

    it('names the current slugs of what the public can reach, and nothing else', async () => {
      // By now the registry also holds an unpublished, a provisioning and a retired slug.
      const response = await list().expect(200);
      expect(response.body).toEqual({
        items: [{ slug: AL_NOOR.slug }, { slug: LINDENHOF.slug }],
        nextCursor: null,
      });
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('leaves out a practice while it is suspended or unpublished', async () => {
      await inRegistry(`UPDATE practices SET status = 'SUSPENDED' WHERE id = $1`, [alNoorId]);
      expect((await list().expect(200)).body).toMatchObject({ items: [{ slug: LINDENHOF.slug }] });
      await inRegistry(`UPDATE practices SET status = 'ACTIVE' WHERE id = $1`, [alNoorId]);

      await inRegistry('UPDATE practices SET published_at = NULL WHERE id = $1', [alNoorId]);
      expect((await list().expect(200)).body).toMatchObject({ items: [{ slug: LINDENHOF.slug }] });
      await inRegistry('UPDATE practices SET published_at = now() WHERE id = $1', [alNoorId]);
    });

    it('walks all pages with the cursor', async () => {
      const first = (await list('?limit=1').expect(200)).body as {
        items: { slug: string }[];
        nextCursor: string;
      };
      expect(first.items).toEqual([{ slug: AL_NOOR.slug }]);
      const second = await list(`?limit=1&cursor=${first.nextCursor}`).expect(200);
      expect(second.body).toEqual({ items: [{ slug: LINDENHOF.slug }], nextCursor: null });
    });

    it('opens no practice database', async () => {
      const connections = app.get(PracticeConnectionManager);
      const creationsBefore = connections.stats().creations;
      await list().expect(200);
      expect(connections.stats().creations).toBe(creationsBefore);
    });

    it('lists only the markets a deployment serves', async () => {
      // This class alone: parseEnv rightly refuses this test's databases for a whole staging app.
      const staging = new PublishedPractices(app.get(PlatformPrismaService), {
        ...app.get<Env>(ENV),
        APP_ENV: 'staging',
        MARKETS: [AL_NOOR.market],
      });
      expect(await staging.slugs(undefined, 10)).toEqual([AL_NOOR.slug]);
    });

    it('answers 400, not a database error, for a cursor that decodes to a NUL byte', async () => {
      const response = await list('?cursor=AA').expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });
});

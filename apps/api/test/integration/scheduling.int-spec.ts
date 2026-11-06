/**
 * Slots and public free times against real databases (08 P04, P05): two practices, each with its
 * own zone, weekend and rules in its own database.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fillPractice, SEED_PRACTICES } from '../../prisma/seed-practices.js';
import type { PracticeRunSummary } from '../../src/common/tenancy/practice-runner.js';
import { FixedClock } from '../../src/common/time/fixed-clock.js';
import { PUBLIC_FREE_TIMES_REQUESTS_PER_MINUTE } from '../../src/modules/scheduling/public-free-times.controller.js';
import { SlotGenerationJob } from '../../src/modules/scheduling/slot-generation.job.js';
import { createTestApp } from '../support/create-test-app.js';
import { usePracticeDatabases } from '../support/practices.js';
import { withClient } from './support/sql.js';

const PATH = '/api/v1/public/practices';
const [AL_NOOR, LINDENHOF] = SEED_PRACTICES;
const [SERVICE, , , NOT_ONLINE] = AL_NOOR.data.services;
const [SARA, OMAR] = AL_NOOR.data.staff;
/** Sunday 2026-11-15: 10:00 in Riyadh, 08:00 in Berlin. */
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');

interface FreeTimes {
  date: string;
  times: { startsAt: string }[];
}

interface Availability {
  days: { date: string; hasFreeTimes: boolean }[];
}

describe('slots and free times on real databases (08 P04, P05)', () => {
  const databases = usePracticeDatabases({ practices: 'none' });
  const clock = new FixedClock(NOW);
  let app: NestExpressApplication;
  let alNoorUrl: string;
  let lindenhofUrl: string;
  let firstRun: PracticeRunSummary;

  const countOf = async (url: string, sql: string, values: unknown[] = []): Promise<number> =>
    withClient(url, async (client) => {
      const result = await client.query<{ count: string }>(sql, values);
      return Number(result.rows[0]?.count);
    });

  const inPractice = async (url: string, sql: string, values: unknown[] = []): Promise<void> => {
    await withClient(url, (client) => client.query(sql, values));
  };

  const publish = async (practiceId: string, slug: string, name: unknown): Promise<void> => {
    await withClient(databases.platformOwnerUrl, async (platform) => {
      await platform.query('INSERT INTO practice_slugs (slug, practice_id) VALUES ($1, $2)', [
        slug,
        practiceId,
      ]);
      await platform.query('UPDATE practices SET name = $2, published_at = now() WHERE id = $1', [
        practiceId,
        name,
      ]);
    });
  };

  const job = (): SlotGenerationJob => app.get(SlotGenerationJob);

  const slotsOf = (date: string, query: Record<string, string> = {}): request.Test =>
    request(app.getHttpServer())
      .get(`${PATH}/${AL_NOOR.slug}/slots`)
      .query({ serviceId: SERVICE?.id, date, ...query });

  const availabilityOf = (query: Record<string, string> = {}): request.Test =>
    request(app.getHttpServer())
      .get(`${PATH}/${AL_NOOR.slug}/availability`)
      .query({ serviceId: SERVICE?.id, ...query });

  beforeAll(async () => {
    const urls: string[] = [];
    for (const practice of [AL_NOOR, LINDENHOF]) {
      const provisioned = await databases.provision({
        market: practice.market,
        timeZone: practice.timeZone,
        defaultLocale: practice.defaultLocale,
      });
      const owner = await provisioned.connectAsOwner();
      await fillPractice(owner, practice.data).finally(() => owner.end());
      await publish(provisioned.practiceId, practice.slug, practice.name);
      urls.push(databases.superuserUrl(`practice_${provisioned.practiceId.replaceAll('-', '')}`));
    }
    [alNoorUrl = '', lindenhofUrl = ''] = urls;
    app = await createTestApp({ env: databases.apiEnv, clock });
    firstRun = await job().run();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('generation (08 P04)', () => {
    it('BR-15 generates for each practice in its own zone and with its own weekend', async () => {
      const onWeekend = `SELECT count(*) FROM slots WHERE status = 'OPEN'
        AND extract(isodow FROM starts_at AT TIME ZONE $1) = ANY ($2::int[])`;
      const beforeHours = `SELECT count(*) FROM slots WHERE status = 'OPEN'
        AND (starts_at AT TIME ZONE $1)::time < $2::time`;
      const open = `SELECT count(*) FROM slots WHERE status = 'OPEN'`;

      expect(firstRun).toEqual({ succeeded: 2, failed: 0 });
      expect(await countOf(alNoorUrl, open)).toBeGreaterThan(0);
      expect(await countOf(alNoorUrl, onWeekend, ['Asia/Riyadh', [5, 6]])).toBe(0);
      expect(await countOf(alNoorUrl, beforeHours, ['Asia/Riyadh', '09:00'])).toBe(0);

      expect(await countOf(lindenhofUrl, open)).toBeGreaterThan(0);
      expect(await countOf(lindenhofUrl, onWeekend, ['Europe/Berlin', [6, 7]])).toBe(0);
      expect(await countOf(lindenhofUrl, beforeHours, ['Europe/Berlin', '08:00'])).toBe(0);
    });

    it('BR-06 skips a closed special day and a provider’s absence', async () => {
      const onDay = `SELECT count(*) FROM slots
        WHERE (starts_at AT TIME ZONE 'Asia/Riyadh')::date = $1::date`;
      expect(await countOf(alNoorUrl, onDay, ['2026-11-19'])).toBe(0);
      const ofOmar = `${onDay} AND provider_id = $2`;
      expect(await countOf(alNoorUrl, ofOmar, ['2026-12-07', OMAR?.id])).toBe(0);
      expect(await countOf(alNoorUrl, ofOmar, ['2026-12-13', OMAR?.id])).toBeGreaterThan(0);
    });

    it('BR-06 creates no slot in a second run, also when two run at once', async () => {
      const all = 'SELECT count(*) FROM slots';
      const before = await countOf(alNoorUrl, all);
      await Promise.all([job().run(), job().run()]);
      expect(await countOf(alNoorUrl, all)).toBe(before);
    });

    it('rejects an overlapping slot of the same provider through EXCLUDE', async () => {
      await expect(
        inPractice(
          alNoorUrl,
          `INSERT INTO slots (provider_id, starts_at, ends_at) VALUES ($1, $2, $3)`,
          [SARA?.id, '2026-11-16T06:10:00Z', '2026-11-16T06:40:00Z'],
        ),
      ).rejects.toMatchObject({ code: '23P01' });
    });
  });

  describe('GET …/slots (08 P05)', () => {
    it('BR-03 shows a slot at now + 120 minutes and not at now + 119', async () => {
      const exactly = (await slotsOf('2026-11-15').expect(200)).body as FreeTimes;
      expect(exactly.times[0]?.startsAt).toBe('2026-11-15T09:00:00Z');

      clock.set(NOW.add({ minutes: 1 }));
      const oneMinuteLater = (await slotsOf('2026-11-15').expect(200)).body as FreeTimes;
      expect(oneMinuteLater.times[0]?.startsAt).toBe('2026-11-15T09:30:00Z');
      clock.set(NOW);
    });

    it('BR-24 may be kept for 30 seconds, and shows each start once, with no slot and no provider', async () => {
      const response = await slotsOf('2026-11-16').expect(200);
      expect(response.headers['cache-control']).toBe('public, max-age=30');
      const { times } = response.body as FreeTimes;
      // Two doctors from 09:00 to 13:00 and one from 16:00 to 20:00, in 30-minute slots.
      expect(times).toHaveLength(16);
      expect(new Set(times.map(({ startsAt }) => startsAt)).size).toBe(16);
      expect(times.flatMap((time) => Object.keys(time))).toEqual(times.map(() => 'startsAt'));
    });

    it('BR-24 serves a chosen doctor only with a public profile', async () => {
      const ofSara = (await slotsOf('2026-11-16', { providerId: SARA?.id ?? '' }).expect(200))
        .body as FreeTimes;
      expect(ofSara.times).toHaveLength(16);
      await slotsOf('2026-11-16', { providerId: OMAR?.id ?? '' }).expect(404);
    });

    it('BR-08 answers 404 for an unknown service, one of another practice and one not online', async () => {
      const otherPractice = LINDENHOF.data.services[0]?.id ?? '';
      for (const serviceId of [
        '99999999-9999-4999-8999-999999999999',
        otherPractice,
        NOT_ONLINE?.id ?? '',
      ]) {
        const response = await slotsOf('2026-11-16', { serviceId }).expect(404);
        expect(response.headers['cache-control']).toBe('no-store');
      }
    });

    it('BR-08 shows only the slots whose rule allows the service', async () => {
      await inPractice(
        alNoorUrl,
        `DELETE FROM availability_rule_services WHERE service_id = $1 AND rule_id IN
           (SELECT id FROM availability_rules WHERE provider_id = $2)`,
        [SERVICE?.id, OMAR?.id],
      );
      const { times } = (await slotsOf('2026-11-16').expect(200)).body as FreeTimes;
      // Now only Sara has this service; her times are the same, because both worked 09:00 to 13:00.
      expect(times).toHaveLength(16);
      await inPractice(
        alNoorUrl,
        `INSERT INTO availability_rule_services (rule_id, service_id)
           SELECT id, $1 FROM availability_rules WHERE provider_id = $2`,
        [SERVICE?.id, OMAR?.id],
      );
    });
  });

  describe('GET …/availability (08 P05)', () => {
    it('answers the next 42 days by default, with the practice’s closed days', async () => {
      const response = await availabilityOf().expect(200);
      expect(response.headers['cache-control']).toBe('public, max-age=30');
      const { days } = response.body as Availability;
      expect(days).toHaveLength(42);
      expect(days[0]).toEqual({ date: '2026-11-15', hasFreeTimes: true });
      const on = (date: string): boolean | undefined =>
        days.find((day) => day.date === date)?.hasFreeTimes;
      expect(on('2026-11-19')).toBe(false); // closed
      expect(on('2026-11-20')).toBe(false); // Friday
      expect(on('2026-11-22')).toBe(true);
    });

    it('answers 400 with a field error on `to` for more than 42 days or a backward range', async () => {
      for (const to of ['2026-12-27', '2026-11-14']) {
        const response = await availabilityOf({ from: '2026-11-15', to }).expect(400);
        expect(response.body).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: [{ field: 'to', code: 'INVALID_VALUE' }],
        });
      }
      await availabilityOf({ from: '2026-11-15', to: '2026-12-26' }).expect(200);
    });

    it('BR-03 leaves out what lies beyond the horizon', async () => {
      await inPractice(
        alNoorUrl,
        `INSERT INTO slots (provider_id, starts_at, ends_at, rule_id)
           SELECT provider_id, '2027-03-01T06:00:00Z', '2027-03-01T06:30:00Z', id
           FROM availability_rules WHERE provider_id = $1 LIMIT 1`,
        [SARA?.id],
      );
      const { times } = (await slotsOf('2027-03-01').expect(200)).body as FreeTimes;
      expect(times).toEqual([]);
    });

    it('BR-07 shows a booked or blocked slot as nothing, and a full day as no free times', async () => {
      const day = '2026-11-23';
      await inPractice(
        alNoorUrl,
        `UPDATE slots SET status = 'BOOKED'
           WHERE (starts_at AT TIME ZONE 'Asia/Riyadh')::date = $1::date`,
        [day],
      );
      expect(((await slotsOf(day).expect(200)).body as FreeTimes).times).toEqual([]);
      const { days } = (await availabilityOf({ from: day, to: day }).expect(200))
        .body as Availability;
      expect(days).toEqual([{ date: day, hasFreeTimes: false }]);
    });

    it('answers 429 after its limit', async () => {
      let status = 0;
      for (let count = 0; count <= PUBLIC_FREE_TIMES_REQUESTS_PER_MINUTE; count += 1) {
        ({ status } = await availabilityOf());
      }
      expect(status).toBe(429);
    });
  });

  describe('a change of the rules (08 P04)', () => {
    it('BR-06 shows nothing of someone who is no provider any more, and stops generating', async () => {
      const jonas = LINDENHOF.data.staff[1]?.id ?? '';
      const ofJonas = `SELECT count(*) FROM slots WHERE status = 'OPEN' AND provider_id = $1`;
      // A time only this person has: outside the hours of the rules, so no other doctor has it.
      const onlyJonas = '2026-11-16T05:30:00Z';
      await inPractice(
        lindenhofUrl,
        `INSERT INTO slots (provider_id, starts_at, ends_at, rule_id)
           SELECT provider_id, $1::timestamptz, $1::timestamptz + interval '30 minutes', id
           FROM availability_rules WHERE provider_id = $2 LIMIT 1`,
        [onlyJonas, jonas],
      );
      const starts = async (): Promise<string[]> => {
        const response = await request(app.getHttpServer())
          .get(`${PATH}/${LINDENHOF.slug}/slots`)
          .query({ serviceId: LINDENHOF.data.services[0]?.id, date: '2026-11-16' })
          .expect(200);
        return (response.body as FreeTimes).times.map(({ startsAt }) => startsAt);
      };
      expect(await starts()).toContain(onlyJonas);
      expect(await countOf(lindenhofUrl, ofJonas, [jonas])).toBeGreaterThan(0);

      await inPractice(lindenhofUrl, 'UPDATE staff_members SET is_provider = false WHERE id = $1', [
        jonas,
      ]);
      expect(await starts()).not.toContain(onlyJonas);

      await job().run();
      expect(await countOf(lindenhofUrl, ofJonas, [jonas])).toBe(0);
    });

    it('BR-07 removes open slots without a rule, and keeps booked and blocked ones', async () => {
      const rule = `SELECT id FROM availability_rules WHERE provider_id = $1 ORDER BY id LIMIT 1`;
      const ofRule = `(${rule})`;
      const anna = LINDENHOF.data.staff[0]?.id ?? '';
      await inPractice(
        lindenhofUrl,
        `UPDATE slots SET status = 'BOOKED' WHERE id = (
           SELECT id FROM slots WHERE rule_id = ${ofRule} ORDER BY starts_at LIMIT 1)`,
        [anna],
      );
      await inPractice(
        lindenhofUrl,
        `UPDATE slots SET status = 'BLOCKED' WHERE id = (
           SELECT id FROM slots WHERE rule_id = ${ofRule} AND status = 'OPEN'
           ORDER BY starts_at LIMIT 1)`,
        [anna],
      );
      const booked = `SELECT count(*) FROM slots WHERE status IN ('BOOKED') AND rule_id IS NULL`;
      const blocked = `SELECT count(*) FROM slots WHERE status IN ('BLOCKED') AND rule_id IS NULL
        AND starts_at < '2030-01-01'`;
      const openWithoutRule = `SELECT count(*) FROM slots WHERE status = 'OPEN' AND rule_id IS NULL`;

      await inPractice(lindenhofUrl, `DELETE FROM availability_rules WHERE id = ${ofRule}`, [anna]);
      expect(await countOf(lindenhofUrl, openWithoutRule)).toBeGreaterThan(0);

      await job().run();
      expect(await countOf(lindenhofUrl, openWithoutRule)).toBe(0);
      expect(await countOf(lindenhofUrl, booked)).toBe(1);
      expect(await countOf(lindenhofUrl, blocked)).toBe(1);
    });
  });
});

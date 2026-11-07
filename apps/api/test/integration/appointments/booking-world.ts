/**
 * What the booking specs share: two practices of the seed in their own databases, accounts that have
 * joined them, and fresh slots. Called at the top of a describe block, like usePracticeDatabases.
 */
import { randomUUID } from 'node:crypto';
import { PRIVACY_NOTICE_VERSION } from '@medibooker/i18n';
import type { ProvisionedPractice } from '@medibooker/db-migrate/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { fillPractice, SEED_PRACTICES } from '../../../prisma/seed-practices.js';
import { PlatformPrismaService } from '../../../src/common/database/platform-prisma.service.js';
import { FixedClock } from '../../../src/common/time/fixed-clock.js';
import { createTestApp } from '../../support/create-test-app.js';
import { usePracticeDatabases } from '../../support/practices.js';
import { withClient } from '../support/sql.js';

export const API = '/api/v1';
/** Sunday 2026-11-15, 10:00 in Riyadh. */
export const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const PASSWORD = 'synthetic correct horse battery';
const SLOT_MINUTES = 30;
const SELF_PAYER = {
  firstName: 'Sami',
  lastName: 'Beispiel',
  dateOfBirth: '1990-04-12',
  insuranceType: 'SELF_PAY',
};

export interface Person {
  readonly userId: string;
  readonly email: string;
  readonly token: string;
}

export interface Fixture {
  readonly practice: ProvisionedPractice;
  /** A service of the seed that can be booked online. */
  readonly serviceId: string;
  /** A service of the seed that cannot. */
  readonly notOnlineServiceId: string;
  /** A doctor with a public profile, and the seed's rule of that doctor for the service. */
  readonly providerId: string;
  readonly ruleId: string;
  /** Another doctor with a rule for the service. */
  readonly otherProviderId: string;
  readonly otherRuleId: string;
}

export function useBookingWorld(env: Readonly<Record<string, string>> = {}) {
  const [AL_NOOR, LINDENHOF] = SEED_PRACTICES;
  const databases = usePracticeDatabases({ practices: 'none' });
  const clock = new FixedClock(NOW);
  let app: NestExpressApplication;
  let alNoor: Fixture;
  let lindenhof: Fixture;
  let people = 0;
  let clients = 0;
  let client = '';
  /** Minutes after NOW of the next fresh slot: each its own time, so that none overlaps another. */
  let nextOffset = 180;

  const nextClient = (): void => {
    clients += 1;
    client = `198.51.${String(100 + Math.floor(clients / 250))}.${String(clients % 250)}`;
  };

  const server = (): ReturnType<NestExpressApplication['getHttpServer']> => app.getHttpServer();
  const platform = (): PlatformPrismaService => app.get(PlatformPrismaService);

  const asOwner = async <T>(
    { practice }: Fixture,
    work: (owner: Awaited<ReturnType<ProvisionedPractice['connectAsOwner']>>) => Promise<T>,
  ): Promise<T> => {
    const owner = await practice.connectAsOwner();
    return work(owner).finally(() => owner.end());
  };

  const send = (test: request.Test, who: Person | undefined): request.Test => {
    test.set('X-Forwarded-For', client);
    return who === undefined ? test : test.set('Authorization', `Bearer ${who.token}`);
  };

  const signIn = async (email: string): Promise<string> => {
    const login = await request(server())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', client)
      .send({ email, password: PASSWORD, delivery: 'body' })
      .expect(200);
    return (login.body as { tokens: { accessToken: string } }).tokens.accessToken;
  };

  /** An account; by default with its address confirmed, and signed in for a Bearer header. */
  const person = async ({ confirmed = true } = {}): Promise<Person> => {
    // Each person their own client: signing up and joining have limits per address.
    nextClient();
    people += 1;
    const email = `booker-${String(people)}@example.test`;
    await request(server())
      .post(`${API}/auth/register`)
      .set('X-Forwarded-For', client)
      .send({
        email,
        password: PASSWORD,
        locale: 'en',
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      })
      .expect(202);
    const user = await platform().user.findUniqueOrThrow({ where: { email } });
    if (confirmed) {
      await platform().user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date(NOW.epochMilliseconds) },
      });
    }
    return { userId: user.id, email, token: await signIn(email) };
  };

  const join = async (
    who: Person,
    fixture: Fixture,
    details: object = SELF_PAYER,
  ): Promise<string> => {
    const response = await send(
      request(server()).post(`${API}/practices/${fixture.practice.practiceId}/me/patients`),
      who,
    )
      .send(details)
      .expect(201);
    return (response.body as { id: string }).id;
  };

  /** A person who has joined this practice. */
  const patient = async (fixture: Fixture, details?: object): Promise<Person> => {
    const who = await person();
    await join(who, fixture, details);
    return who;
  };

  /** A slot of this doctor at this time, for the rule's services. */
  const slotAt = async (
    fixture: Fixture,
    startsAt: Temporal.Instant,
    { other = false, status = 'OPEN' } = {},
  ): Promise<string> =>
    asOwner(fixture, async (owner) => {
      const { rows } = await owner.query<{ id: string }>(
        `INSERT INTO slots (provider_id, rule_id, starts_at, ends_at, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          other ? fixture.otherProviderId : fixture.providerId,
          other ? fixture.otherRuleId : fixture.ruleId,
          startsAt.toString(),
          startsAt.add({ minutes: SLOT_MINUTES }).toString(),
          status,
        ],
      );
      return rows[0]?.id ?? '';
    });

  /** The start of a fresh time inside the booking window: nothing else is there. */
  const freshTime = (): Temporal.Instant => {
    nextOffset += SLOT_MINUTES + 1;
    return NOW.add({ minutes: nextOffset });
  };

  const freshSlot = async (fixture: Fixture): Promise<Temporal.Instant> => {
    const startsAt = freshTime();
    await slotAt(fixture, startsAt);
    return startsAt;
  };

  /** From an address of its own: a booking has its limit per address, and one test asks for that. */
  const book = (
    who: Person | undefined,
    fixture: Fixture,
    body: object,
    key: string = randomUUID(),
  ): request.Test => {
    nextClient();
    return send(
      request(server()).post(`${API}/practices/${fixture.practice.practiceId}/appointments`),
      who,
    )
      .set('Idempotency-Key', key)
      .send(body);
  };

  const fixtureOf = async (
    seed: (typeof SEED_PRACTICES)[number],
    name: string,
  ): Promise<Fixture> => {
    const practice = await databases.provision({
      market: seed.market,
      timeZone: seed.timeZone,
      defaultLocale: seed.defaultLocale,
    });
    const owner = await practice.connectAsOwner();
    await fillPractice(owner, seed.data).finally(() => owner.end());
    await withClient(databases.platformOwnerUrl, async (registry) => {
      await registry.query('INSERT INTO practice_slugs (slug, practice_id) VALUES ($1, $2)', [
        name,
        practice.practiceId,
      ]);
      await registry.query('UPDATE practices SET name = $2, published_at = now() WHERE id = $1', [
        practice.practiceId,
        { en: name },
      ]);
    });
    const online = seed.data.services.find((service) => service.isBookableOnline !== false);
    const notOnline = seed.data.services.find((service) => service.isBookableOnline === false);
    const publicDoctor = seed.data.staff.find((member) =>
      member.consents.some(({ type }) => type === 'PUBLIC_PROFILE'),
    );
    const ruleOfService = (
      wanted: (providerId: string) => boolean,
    ): (typeof seed.data.availabilityRules)[number] | undefined =>
      seed.data.availabilityRules.find(
        (rule) => wanted(rule.providerId) && rule.serviceIds.includes(online?.id ?? ''),
      );
    const rule = ruleOfService((providerId) => providerId === publicDoctor?.id);
    const otherRule = ruleOfService((providerId) => providerId !== publicDoctor?.id);
    return {
      practice,
      serviceId: online?.id ?? '',
      notOnlineServiceId: notOnline?.id ?? '',
      providerId: rule?.providerId ?? '',
      ruleId: rule?.id ?? '',
      otherProviderId: otherRule?.providerId ?? rule?.providerId ?? '',
      otherRuleId: otherRule?.id ?? rule?.id ?? '',
    };
  };

  /** The rules of BR-02 and BR-03 at their defaults, so that a test can read them here. */
  const setRules = async (
    fixture: Fixture,
    { limit = 2, leadMinutes = 120, horizonDays = 90 } = {},
  ): Promise<void> => {
    await asOwner(fixture, (owner) =>
      owner.query(
        `UPDATE practice_settings SET max_future_appointments_per_patient = $1,
           min_lead_time_minutes = $2, max_horizon_days = $3`,
        [limit, leadMinutes, horizonDays],
      ),
    );
  };

  beforeAll(async () => {
    alNoor = await fixtureOf(AL_NOOR, 'al-noor');
    lindenhof = await fixtureOf(LINDENHOF, 'lindenhof');
    await setRules(alNoor);
    await setRules(lindenhof);
    app = await createTestApp({
      // One proxy in front, so that each test is its own client with its own limits.
      env: { ...databases.apiEnv, TRUST_PROXY_HOPS: '1', ...env },
      clock,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    nextClient();
    clock.set(NOW);
  });

  return {
    clock,
    app: (): NestExpressApplication => app,
    alNoor: (): Fixture => alNoor,
    lindenhof: (): Fixture => lindenhof,
    server,
    platform,
    asOwner,
    send,
    signIn,
    person,
    join,
    patient,
    slotAt,
    freshTime,
    freshSlot,
    book,
    setRules,
    /** Rows of the practice's appointments table for a time. */
    activeAt: (fixture: Fixture, startsAt: Temporal.Instant) =>
      asOwner(fixture, async (owner) => {
        const { rows } = await owner.query<{ id: string; slot_status: string }>(
          `SELECT a.id, s.status AS slot_status FROM appointments a JOIN slots s ON s.id = a.slot_id
           WHERE s.starts_at = $1 AND a.status <> 'CANCELLED'`,
          [startsAt.toString()],
        );
        return rows;
      }),
  };
}

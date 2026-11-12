import type { NestExpressApplication } from '@nestjs/platform-express';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Actor, Authenticator } from '../../src/common/security/actor.js';
import { PracticeAccessIndex } from '../../src/common/tenancy/practice-access-index.js';
import { PracticeConnectionManager } from '../../src/common/tenancy/practice-connection-manager.js';
import { PracticeResolver } from '../../src/common/tenancy/practice-resolver.js';
import { FixedClock } from '../../src/common/time/fixed-clock.js';
import { SLOT_GENERATION_JOB } from '../../src/modules/scheduling/slot-generation.job.js';
import { createTestApp } from '../support/create-test-app.js';
import { PRACTICE_A, practiceRoute } from '../support/practice-routes.js';

const PATH = `/api/v1/practices/${PRACTICE_A}`;
const SERVICE = '10000000-0000-4000-8000-000000000001';
const RULE = '30000000-0000-4000-8000-000000000001';
const STARTS = ['2026-11-15T09:00:00.000Z', '2026-11-15T09:30:00.000Z'];
/** What the fake authenticator takes: no token is real here. */
const BEARER = 'Bearer synthetic-test-token';
const ACTOR: Actor = { userId: 'user-1', sessionId: 'session-1', amr: ['pwd'] };
/** Another account, which has its own places (security review of B07). */
const OTHER_BEARER = 'Bearer synthetic-other-token';
const OTHER_ACTOR: Actor = { userId: 'user-2', sessionId: 'session-2', amr: ['pwd'] };
const ACTORS: Readonly<Record<string, Actor>> = { [BEARER]: ACTOR, [OTHER_BEARER]: OTHER_ACTOR };

/** The service's time (BR-27): one slot of 30 minutes holds its visit and buffer. */
interface ServiceTime {
  readonly durationMinutes: number;
  readonly bufferMinutes: number;
}

/** A practice client that returns synthetic rows: the routes never reach a database here. */
const client = {
  practiceSettings: {
    findUniqueOrThrow: () =>
      Promise.resolve({ timeZone: 'Asia/Riyadh', minLeadTimeMinutes: 120, maxHorizonDays: 90 }),
  },
  service: {
    findFirst: vi.fn(() =>
      Promise.resolve<ServiceTime | null>({ durationMinutes: 20, bufferMinutes: 5 }),
    ),
  },
  staffMember: { findFirst: vi.fn(() => Promise.resolve<{ id: string } | null>(null)) },
  slot: {
    // Two free slots of one doctor, whose rule offers the service.
    findMany: vi.fn(() =>
      Promise.resolve(
        STARTS.map((startsAt, index) => ({
          id: `40000000-0000-4000-8000-00000000000${String(index)}`,
          providerId: '20000000-0000-4000-8000-000000000001',
          startsAt: new Date(startsAt),
          endsAt: new Date(Date.parse(startsAt) + 30 * 60_000),
          status: 'OPEN',
          heldById: null,
          ruleId: RULE,
        })),
      ),
    ),
  },
  availabilityRule: {
    findMany: vi.fn(() =>
      Promise.resolve([{ id: RULE, providerId: '20000000-0000-4000-8000-000000000001' }]),
    ),
  },
};

describe('the free times of a signed-in account without a database (B07)', () => {
  let app: NestExpressApplication;
  const isVerified = vi.fn(() => Promise.resolve(true));

  beforeAll(async () => {
    const release = vi.fn();
    app = await createTestApp({
      // Sunday 2026-11-15, 10:00 in Riyadh.
      clock: new FixedClock(Temporal.Instant.from('2026-11-15T07:00:00Z')),
      overrides: [
        {
          provide: Authenticator,
          useValue: {
            authenticate: ({
              headers,
            }: {
              readonly headers: Readonly<Record<string, unknown>>;
            }): Promise<Actor | undefined> =>
              Promise.resolve(
                typeof headers.authorization === 'string'
                  ? ACTORS[headers.authorization]
                  : undefined,
              ),
          },
        },
        {
          provide: PracticeAccessIndex,
          useValue: { isVerified, capacitiesOf: () => Promise.resolve([]) },
        },
        {
          provide: PracticeResolver,
          useValue: {
            resolvePublished: () =>
              Promise.resolve({ answer: 'SERVE', route: practiceRoute(PRACTICE_A) }),
            activePracticeIds: () => Promise.resolve([]),
          },
        },
        {
          provide: PracticeConnectionManager,
          useValue: {
            acquire: () => Promise.resolve({ practiceId: PRACTICE_A, client, release }),
            close: vi.fn(),
            evictIdle: vi.fn(),
            stats: vi.fn(),
          },
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (route: string, query: Record<string, string>, bearer = BEARER): request.Test =>
    request(app.getHttpServer()).get(`${PATH}/${route}`).set('Authorization', bearer).query(query);

  it('lets one account have two answers under way at once, and another account its own', async () => {
    let letGo = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    const rules = client.availabilityRule.findMany;
    const rows = await rules();
    rules.mockClear();
    rules.mockImplementation(async () => {
      await held;
      return rows;
    });
    const query = { serviceId: SERVICE, date: '2026-11-15' };
    try {
      const running = [
        get('free-times', query).then((r) => r),
        get('free-times', query).then((r) => r),
      ];
      await vi.waitFor(() => {
        expect(rules).toHaveBeenCalledTimes(2);
      });
      const third = await get('free-times', query);
      expect(third.status).toBe(429);
      expect(third.body).toMatchObject({ code: 'RATE_LIMITED' });
      // Another account is not held up by the first one's places.
      running.push(get('free-times', query, OTHER_BEARER).then((r) => r));
      await vi.waitFor(() => {
        expect(rules).toHaveBeenCalledTimes(3);
      });
      letGo();
      expect((await Promise.all(running)).map(({ status }) => status)).toEqual([200, 200, 200]);
    } finally {
      letGo();
      rules.mockImplementation(() => Promise.resolve(rows));
    }
  });

  it('names the starts and no slot, and no cache keeps them', async () => {
    const response = await get('free-times', { serviceId: SERVICE, date: '2026-11-15' }).expect(
      200,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      date: '2026-11-15',
      times: [{ startsAt: '2026-11-15T09:00:00Z' }, { startsAt: '2026-11-15T09:30:00Z' }],
    });
  });

  it('says only whether a day has a free time', async () => {
    const response = await get('availability', {
      serviceId: SERVICE,
      from: '2026-11-15',
      to: '2026-11-16',
    }).expect(200);
    expect(response.body).toEqual({
      days: [
        { date: '2026-11-15', hasFreeTimes: true },
        { date: '2026-11-16', hasFreeTimes: false },
      ],
    });
  });

  it('answers 401 without a sign-in, before any practice is looked up', async () => {
    const response = await request(app.getHttpServer())
      .get(`${PATH}/free-times`)
      .query({ serviceId: SERVICE, date: '2026-11-15' })
      .expect(401);
    expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuses an account whose address is not confirmed (BR-09)', async () => {
    isVerified.mockResolvedValueOnce(false);
    const response = await get('free-times', { serviceId: SERVICE, date: '2026-11-15' }).expect(
      403,
    );
    expect(response.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('answers errors with no-store too, and a doctor without a public profile is 404', async () => {
    const response = await get('free-times', {
      serviceId: SERVICE,
      date: '2026-11-15',
      providerId: '20000000-0000-4000-8000-000000000001',
    }).expect(404);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('answers 404 for a service that cannot be booked online', async () => {
    client.service.findFirst.mockResolvedValueOnce(null);
    await get('free-times', { serviceId: SERVICE, date: '2026-11-15' }).expect(404);
    expect(client.service.findFirst).toHaveBeenCalled();
  });

  it.each([
    ['a missing service', { date: '2026-11-15' }, 'serviceId'],
    ['a service that is no id', { serviceId: 'x', date: '2026-11-15' }, 'serviceId'],
    [
      'a provider that is no id',
      { serviceId: SERVICE, date: '2026-11-15', providerId: 'x' },
      'providerId',
    ],
    ['a missing day', { serviceId: SERVICE }, 'date'],
    ['a day that does not exist', { serviceId: SERVICE, date: '2027-02-30' }, 'date'],
    ['a time instead of a day', { serviceId: SERVICE, date: '2026-11-15T10:00:00Z' }, 'date'],
  ])('rejects %s', async (_case, query, field) => {
    const response = await get('free-times', query).expect(400);
    expect((response.body as { errors: { field: string }[] }).errors.map((e) => e.field)).toContain(
      field,
    );
  });

  it('registers the nightly job', () => {
    expect(app.get(SchedulerRegistry).getCronJob(SLOT_GENERATION_JOB)).toBeDefined();
  });
});

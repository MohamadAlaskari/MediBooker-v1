import type { NestExpressApplication } from '@nestjs/platform-express';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PracticeConnectionManager } from '../../src/common/tenancy/practice-connection-manager.js';
import { PracticeResolver } from '../../src/common/tenancy/practice-resolver.js';
import { FixedClock } from '../../src/common/time/fixed-clock.js';
import { SLOT_GENERATION_JOB } from '../../src/modules/scheduling/slot-generation.job.js';
import { createTestApp } from '../support/create-test-app.js';
import { PRACTICE_A, practiceRoute } from '../support/practice-routes.js';

const PATH = '/api/v1/public/practices/al-noor';
const SERVICE = '10000000-0000-4000-8000-000000000001';
const STARTS = ['2026-11-15T09:00:00.000Z', '2026-11-15T09:30:00.000Z'];

/** A practice client that returns synthetic rows: the routes never reach a database here. */
const client = {
  practiceSettings: {
    findUniqueOrThrow: () =>
      Promise.resolve({ timeZone: 'Asia/Riyadh', minLeadTimeMinutes: 120, maxHorizonDays: 90 }),
  },
  service: { findFirst: vi.fn(() => Promise.resolve<{ id: string } | null>({ id: SERVICE })) },
  staffMember: { findFirst: vi.fn(() => Promise.resolve<{ id: string } | null>(null)) },
  slot: {
    groupBy: vi.fn(() =>
      Promise.resolve(STARTS.map((startsAt) => ({ startsAt: new Date(startsAt) }))),
    ),
  },
};

describe('the public free times without a database', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const release = vi.fn();
    app = await createTestApp({
      // Sunday 2026-11-15, 10:00 in Riyadh.
      clock: new FixedClock(Temporal.Instant.from('2026-11-15T07:00:00Z')),
      overrides: [
        {
          provide: PracticeResolver,
          useValue: {
            resolveSlug: () =>
              Promise.resolve({
                answer: 'SERVE',
                route: practiceRoute(PRACTICE_A),
                listing: { slug: 'al-noor', name: {} },
              }),
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

  const get = (route: string, query: Record<string, string>): request.Test =>
    request(app.getHttpServer()).get(`${PATH}/${route}`).query(query);

  it('names the starts and no slot, in a form a browser may keep for 30 seconds', async () => {
    const response = await get('slots', { serviceId: SERVICE, date: '2026-11-15' }).expect(200);
    expect(response.headers['cache-control']).toBe('public, max-age=30');
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

  it('answers errors with no-store, also on a route that may be kept', async () => {
    const response = await get('slots', {
      serviceId: SERVICE,
      date: '2026-11-15',
      providerId: '20000000-0000-4000-8000-000000000001',
    }).expect(404);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('answers 404 for a service that cannot be booked online', async () => {
    client.service.findFirst.mockResolvedValueOnce(null);
    await get('slots', { serviceId: SERVICE, date: '2026-11-15' }).expect(404);
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
    const response = await get('slots', query).expect(400);
    expect((response.body as { errors: { field: string }[] }).errors.map((e) => e.field)).toContain(
      field,
    );
  });

  it('registers the nightly job', () => {
    expect(app.get(SchedulerRegistry).getCronJob(SLOT_GENERATION_JOB)).toBeDefined();
  });
});

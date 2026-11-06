import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PracticeConnectionManager } from '../../src/common/tenancy/practice-connection-manager.js';
import { PracticeUnavailableError } from '../../src/common/tenancy/practice-errors.js';
import {
  PracticeResolver,
  type SlugResolution,
} from '../../src/common/tenancy/practice-resolver.js';
import { PublishedPractices } from '../../src/common/tenancy/published-practices.js';
import { FixedClock } from '../../src/common/time/fixed-clock.js';
import { PUBLIC_PRACTICE_REQUESTS_PER_MINUTE } from '../../src/modules/public-practice/public-practice.controller.js';
import { createTestApp } from '../support/create-test-app.js';
import { PRACTICE_A, practiceRoute } from '../support/practice-routes.js';
import { problemWithoutRequestId } from '../support/problem.js';
import {
  keyPathsOf,
  PUBLIC_PRACTICE_KEY_PATHS,
  publicPracticeRows,
} from '../support/public-practice-rows.js';

const PATH = '/api/v1/public/practices';
const ROWS = publicPracticeRows();
const ROUTE = practiceRoute(PRACTICE_A);
const SERVED: SlugResolution = {
  answer: 'SERVE',
  route: ROUTE,
  listing: { slug: ROWS.slug, name: ROWS.name },
};

/** A practice client that returns the synthetic rows: the routes never reach a database here. */
const client = {
  practiceSettings: { findUniqueOrThrow: () => Promise.resolve(ROWS.settings) },
  practicePage: { findUniqueOrThrow: () => Promise.resolve(ROWS.page) },
  practiceTheme: { findUniqueOrThrow: () => Promise.resolve(ROWS.theme) },
  openingHours: { findMany: () => Promise.resolve(ROWS.openingHours) },
  specialDay: { findMany: () => Promise.resolve(ROWS.specialDays) },
  service: { findMany: () => Promise.resolve(ROWS.services) },
  staffMember: { findMany: () => Promise.resolve(ROWS.team) },
};

const PUBLISHED_SLUGS = ['al-noor', 'lindenhof', 'the-third'];

function setUp(resolveSlug: (slug: string) => SlugResolution) {
  const release = vi.fn();
  const acquire = vi.fn(() => Promise.resolve({ practiceId: PRACTICE_A, client, release }));
  const resolver = { resolveSlug: vi.fn((slug: string) => Promise.resolve(resolveSlug(slug))) };
  const published = {
    slugs: vi.fn((_after: string | undefined, take: number) =>
      Promise.resolve(PUBLISHED_SLUGS.slice(0, take)),
    ),
  };
  const app = createTestApp({
    // Sunday 2026-11-15, 10:00 in Riyadh.
    clock: new FixedClock(Temporal.Instant.from('2026-11-15T07:00:00Z')),
    overrides: [
      { provide: PracticeResolver, useValue: resolver },
      { provide: PublishedPractices, useValue: published },
      {
        provide: PracticeConnectionManager,
        useValue: { acquire, close: vi.fn(), evictIdle: vi.fn(), stats: vi.fn() },
      },
    ],
  });
  return { app, acquire, release, resolver, published };
}

describe('GET /api/v1/public/practices without a database', () => {
  const { app: created, acquire, published } = setUp(() => SERVED);
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await created;
  });

  afterAll(async () => {
    await app.close();
  });

  const list = (query = ''): request.Test => request(app.getHttpServer()).get(`${PATH}${query}`);

  it('answers without sign-in with slugs only, and leases no practice client', async () => {
    acquire.mockClear();
    const response = await list().expect(200);
    expect(response.body).toEqual({
      items: [{ slug: 'al-noor' }, { slug: 'lindenhof' }, { slug: 'the-third' }],
      nextCursor: null,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(acquire).not.toHaveBeenCalled();
  });

  it('asks for 20 by default, and one more to see whether a page follows', async () => {
    published.slugs.mockClear();
    await list().expect(200);
    expect(published.slugs).toHaveBeenCalledWith(undefined, 21);
  });

  it('continues behind the slug of its cursor', async () => {
    const first = await list('?limit=2').expect(200);
    const { items, nextCursor } = first.body as { items: unknown[]; nextCursor: string };
    expect(items).toEqual([{ slug: 'al-noor' }, { slug: 'lindenhof' }]);
    published.slugs.mockClear();
    await list(`?limit=2&cursor=${nextCursor}`).expect(200);
    expect(published.slugs).toHaveBeenCalledWith('lindenhof', 3);
  });

  it.each([
    ['limit=0', 'limit', 'TOO_SMALL'],
    ['limit=101', 'limit', 'TOO_LARGE'],
    ['limit=abc', 'limit', 'INVALID_TYPE'],
    ['cursor=%20', 'cursor', 'INVALID_FORMAT'],
    // Well-formed cursors that decode to a NUL byte, which the database would refuse with a 500.
    ['cursor=AA', 'cursor', 'INVALID_FORMAT'],
    ['cursor=YQBi', 'cursor', 'INVALID_FORMAT'],
    ['cursor=a&cursor=b', 'cursor', 'INVALID_TYPE'],
    ['practiceId=1', 'practiceId', 'UNKNOWN_FIELD'],
  ])('rejects %s and names the field', async (query, field, code) => {
    published.slugs.mockClear();
    const response = await list(`?${query}`).expect(400);
    const { code: problem, errors } = response.body as {
      code: string;
      errors: { field: string; code: string }[];
    };
    expect(problem).toBe('VALIDATION_FAILED');
    expect(errors).toContainEqual(expect.objectContaining({ field, code }));
    expect(published.slugs).not.toHaveBeenCalled();
  });
});

describe('the rate limit of the list', () => {
  const { app: created } = setUp(() => ({ answer: 'NOT_FOUND' }));
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await created;
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 429 for the 61st request of an address within a minute', async () => {
    for (let count = 0; count < PUBLIC_PRACTICE_REQUESTS_PER_MINUTE; count += 1) {
      await request(app.getHttpServer()).get(PATH).expect(200);
    }
    const response = await request(app.getHttpServer()).get(PATH).expect(429);
    expect(response.headers['retry-after']).toBeDefined();
  });
});

describe('GET /api/v1/public/practices/:slug without a database', () => {
  describe('a served practice', () => {
    const { app: created, acquire, release } = setUp(() => SERVED);
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await created;
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers without sign-in, with exactly the allowlisted fields', async () => {
      const response = await request(app.getHttpServer()).get(`${PATH}/al-noor`).expect(200);
      expect(keyPathsOf(response.body)).toEqual(PUBLIC_PRACTICE_KEY_PATHS);
      expect(response.body).toMatchObject({ slug: 'al-noor', openNow: true });
    });

    it('leases the client for the public purpose and releases it', async () => {
      acquire.mockClear();
      release.mockClear();
      await request(app.getHttpServer()).get(`${PATH}/al-noor`).expect(200);
      expect(acquire).toHaveBeenCalledWith(ROUTE, 'public');
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('sets Cache-Control to exactly no-store and names the language of the texts', async () => {
      const arabic = await request(app.getHttpServer()).get(`${PATH}/al-noor`).expect(200);
      expect(arabic.headers['cache-control']).toBe('no-store');
      expect(arabic.headers['content-language']).toBe('ar');
      expect(arabic.body).toMatchObject({ locale: 'ar', name: 'مركز النور' });

      const english = await request(app.getHttpServer())
        .get(`${PATH}/al-noor`)
        .set('Accept-Language', 'en')
        .expect(200);
      expect(english.headers['content-language']).toBe('en');
      expect(english.body).toMatchObject({ locale: 'en', name: 'Al Noor Centre' });
    });
  });

  describe('a practice that is not served', () => {
    const {
      app: created,
      acquire,
      resolver,
    } = setUp((slug) => {
      if (slug === 'suspended') {
        return {
          answer: 'UNAVAILABLE',
          practiceId: PRACTICE_A,
          reason: 'PRACTICE_STATUS_UNAVAILABLE',
        };
      }
      return { answer: 'NOT_FOUND' };
    });
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await created;
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers 404 with one body for what the registry hides, and leases no client', async () => {
      acquire.mockClear();
      const unknown = await request(app.getHttpServer()).get(`${PATH}/unknown`).expect(404);
      const unpublished = await request(app.getHttpServer()).get(`${PATH}/unpublished`).expect(404);
      expect(problemWithoutRequestId(unpublished)).toEqual(problemWithoutRequestId(unknown));
      expect(acquire).not.toHaveBeenCalled();
    });

    it.each(['ab', 'UPPERCASE', 'has_underscore', 'a'.repeat(41)])(
      'answers the same 404 for %s without reading the registry',
      async (slug) => {
        resolver.resolveSlug.mockClear();
        const unknown = await request(app.getHttpServer()).get(`${PATH}/unknown`).expect(404);
        resolver.resolveSlug.mockClear();
        const invalid = await request(app.getHttpServer()).get(`${PATH}/${slug}`).expect(404);
        expect(problemWithoutRequestId(invalid)).toEqual(problemWithoutRequestId(unknown));
        expect(resolver.resolveSlug).not.toHaveBeenCalled();
      },
    );

    it('answers 503 with Retry-After for a suspended practice, and leases no client', async () => {
      acquire.mockClear();
      const response = await request(app.getHttpServer()).get(`${PATH}/suspended`).expect(503);
      expect(response.headers['retry-after']).toBe('30');
      expect(acquire).not.toHaveBeenCalled();
    });
  });

  describe('a practice whose client cannot be opened', () => {
    const { app: created, acquire } = setUp(() => SERVED);
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await created;
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers 503 with Retry-After', async () => {
      acquire.mockRejectedValueOnce(
        new PracticeUnavailableError(PRACTICE_A, 'PRACTICE_CREATION_RATE_EXCEEDED'),
      );
      const response = await request(app.getHttpServer()).get(`${PATH}/al-noor`).expect(503);
      expect(response.headers['retry-after']).toBe('30');
    });
  });

  describe('the rate limit', () => {
    const { app: created } = setUp(() => ({ answer: 'NOT_FOUND' }));
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await created;
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers 429 with Retry-After for the 61st request of an address within a minute', async () => {
      expect(PUBLIC_PRACTICE_REQUESTS_PER_MINUTE).toBe(60);
      for (let count = 0; count < PUBLIC_PRACTICE_REQUESTS_PER_MINUTE; count += 1) {
        await request(app.getHttpServer()).get(`${PATH}/unknown`).expect(404);
      }
      const response = await request(app.getHttpServer()).get(`${PATH}/unknown`).expect(429);
      expect(response.headers['retry-after']).toBeDefined();
    });
  });
});

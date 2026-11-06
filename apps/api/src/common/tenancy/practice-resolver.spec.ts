import { describe, expect, it, vi } from 'vitest';
import { PRACTICE_A, PRACTICE_B } from '../../../test/support/practice-routes.js';
import { TEST_ENV } from '../../../test/support/test-env.js';
import { parseEnv } from '../../config/env.schema.js';
import { PRACTICE_SCHEMA_REQUIRED } from '../../generated/schema-versions.js';
import type { PlatformPrismaService } from '../database/platform-prisma.service.js';
import { PracticeResolver } from './practice-resolver.js';

/** A registry row as the resolver selects it. */
function registryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PRACTICE_A,
    status: 'ACTIVE',
    market: 'SA',
    clusterId: 'local',
    databaseName: 'practice_0000000000004000800000000000000a',
    appSecretRef: 'dev:practice_0000000000004000800000000000000a_app',
    routeVersion: 3,
    schemaVersion: PRACTICE_SCHEMA_REQUIRED,
    ...overrides,
  };
}

function resolverWith(
  row: Record<string, unknown> | null,
  env = parseEnv(TEST_ENV),
): { resolver: PracticeResolver; findUnique: ReturnType<typeof vi.fn> } {
  const findUnique = vi.fn().mockResolvedValue(row);
  const findMany = vi.fn().mockResolvedValue([{ id: PRACTICE_A }, { id: PRACTICE_B }]);
  const platform = { practice: { findUnique, findMany } } as unknown as PlatformPrismaService;
  return { resolver: new PracticeResolver(platform, env), findUnique };
}

/** A practice_slugs row as resolveSlug selects it. */
function slugRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    practice: {
      ...registryRow(),
      name: { en: 'A practice' },
      publishedAt: new Date('2026-11-01T00:00:00.000Z'),
      slugs: [{ slug: 'current-slug' }],
      ...overrides,
    },
  };
}

function slugResolverWith(row: Record<string, unknown> | null, env = parseEnv(TEST_ENV)) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const platform = { practiceSlug: { findUnique } } as unknown as PlatformPrismaService;
  return { resolver: new PracticeResolver(platform, env), findUnique };
}

describe('PracticeResolver.resolveSlug', () => {
  it('serves a published practice with its current slug and name, also for a retired slug', async () => {
    const { resolver, findUnique } = slugResolverWith(slugRow());
    expect(await resolver.resolveSlug('retired-slug')).toEqual({
      answer: 'SERVE',
      route: expect.objectContaining({
        id: PRACTICE_A,
        schemaVersion: PRACTICE_SCHEMA_REQUIRED,
      }) as unknown,
      listing: { slug: 'current-slug', name: { en: 'A practice' } },
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'retired-slug' } }),
    );
  });

  it('keeps the requested slug when the practice has no current one', async () => {
    const { resolver } = slugResolverWith(slugRow({ slugs: [] }));
    expect(await resolver.resolveSlug('only-slug')).toMatchObject({
      listing: { slug: 'only-slug' },
    });
  });

  it('answers NOT_FOUND for an unknown slug and for an unpublished practice', async () => {
    expect(await slugResolverWith(null).resolver.resolveSlug('unknown')).toEqual({
      answer: 'NOT_FOUND',
    });
    expect(
      await slugResolverWith(slugRow({ publishedAt: null })).resolver.resolveSlug('hidden'),
    ).toEqual({ answer: 'NOT_FOUND' });
  });

  it('applies the status table of public requests', async () => {
    const provisioning = slugResolverWith(slugRow({ status: 'PROVISIONING' }));
    expect(await provisioning.resolver.resolveSlug('slug')).toEqual({ answer: 'NOT_FOUND' });
    const suspended = slugResolverWith(slugRow({ status: 'SUSPENDED' }));
    expect(await suspended.resolver.resolveSlug('slug')).toEqual({
      answer: 'UNAVAILABLE',
      practiceId: PRACTICE_A,
      reason: 'PRACTICE_STATUS_UNAVAILABLE',
    });
  });

  it('answers NOT_FOUND for an unpublished practice whatever its status', async () => {
    const { resolver } = slugResolverWith(slugRow({ status: 'SUSPENDED', publishedAt: null }));
    expect(await resolver.resolveSlug('slug')).toEqual({ answer: 'NOT_FOUND' });
  });
});

describe('PracticeResolver', () => {
  it('reads the registry row of the practice on every call', async () => {
    const { resolver, findUnique } = resolverWith(registryRow());
    await resolver.resolve(PRACTICE_A, 'request');
    await resolver.resolve(PRACTICE_A, 'request');
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: PRACTICE_A } }));
  });

  it('serves an ACTIVE practice with its route', async () => {
    const { resolver } = resolverWith(registryRow());
    expect(await resolver.resolve(PRACTICE_A, 'request')).toEqual({
      answer: 'SERVE',
      route: {
        id: PRACTICE_A,
        status: 'ACTIVE',
        market: 'SA',
        clusterId: 'local',
        databaseName: 'practice_0000000000004000800000000000000a',
        appSecretRef: 'dev:practice_0000000000004000800000000000000a_app',
        routeVersion: 3,
        schemaVersion: PRACTICE_SCHEMA_REQUIRED,
      },
    });
  });

  it('answers NOT_FOUND for an unknown practice and for a status that hides it', async () => {
    expect(await resolverWith(null).resolver.resolve(PRACTICE_A, 'request')).toEqual({
      answer: 'NOT_FOUND',
    });
    const provisioning = resolverWith(registryRow({ status: 'PROVISIONING', clusterId: null }));
    expect(await provisioning.resolver.resolve(PRACTICE_A, 'request')).toEqual({
      answer: 'NOT_FOUND',
    });
  });

  it('answers UNAVAILABLE with the reason of the status table, the market check or the schema guard', async () => {
    const suspended = resolverWith(registryRow({ status: 'SUSPENDED' }));
    expect(await suspended.resolver.resolve(PRACTICE_A, 'job')).toEqual({
      answer: 'UNAVAILABLE',
      reason: 'PRACTICE_STATUS_UNAVAILABLE',
    });
    const staging = parseEnv({
      ...TEST_ENV,
      APP_ENV: 'staging',
      NODE_ENV: 'production',
      TRUST_PROXY_HOPS: '1',
      RATE_LIMIT_PER_MINUTE: '120',
      SECRET_STORE: '',
      PLATFORM_DATABASE_URL:
        'postgresql://platform_app:pw@db.internal.test:5432/medibooker_platform?sslmode=verify-full&sslrootcert=/ca.pem',
      MARKETS: 'DE',
      PUBLIC_WEB_URL: 'https://web.example.test',
      AUTH_SIGNING_KEY_REFS: 'hosted:auth-signing-key',
      AUTH_SECRET_REF: 'hosted:auth-secret',
    });
    expect(
      await resolverWith(registryRow(), staging).resolver.resolve(PRACTICE_A, 'request'),
    ).toEqual({
      answer: 'UNAVAILABLE',
      reason: 'PRACTICE_MARKET_NOT_SERVED',
    });
    const behind = resolverWith(registryRow({ schemaVersion: '20260101000000_older' }));
    expect(await behind.resolver.resolve(PRACTICE_A, 'request')).toEqual({
      answer: 'UNAVAILABLE',
      reason: 'PRACTICE_SCHEMA_BEHIND',
    });
  });

  it.each(['clusterId', 'databaseName', 'appSecretRef'])(
    'answers UNAVAILABLE for an ACTIVE practice without %s',
    async (field) => {
      const { resolver } = resolverWith(registryRow({ [field]: null }));
      expect(await resolver.resolve(PRACTICE_A, 'request')).toEqual({
        answer: 'UNAVAILABLE',
        reason: 'PRACTICE_ROUTE_INCOMPLETE',
      });
    },
  );

  it('lists the ACTIVE practices in a stable order', async () => {
    const { resolver } = resolverWith(null);
    expect(await resolver.activePracticeIds()).toEqual([PRACTICE_A, PRACTICE_B]);
  });
});

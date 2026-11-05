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

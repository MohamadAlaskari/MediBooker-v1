import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRISMA_ROOT, parseToolEnvironment } from './environment.ts';

const PLATFORM =
  'postgresql://platform_owner:changeme-platform-owner@127.0.0.1:5432/medibooker_platform';

describe('parseToolEnvironment', () => {
  it('applies the defaults of 02 §7', () => {
    const result = parseToolEnvironment({ APP_ENV: 'local', PLATFORM_MIGRATION_URL: PLATFORM });
    expect(result).toEqual({
      ok: true,
      value: {
        appEnv: 'local',
        platformUrl: PLATFORM,
        provisionerUrl: undefined,
        adminUrl: undefined,
        secretStore: undefined,
        devSecretSeed: undefined,
        clusterEndpoints: new Map(),
        markets: undefined,
        migrationConcurrency: 4,
        migrationTimeoutMs: 300_000,
        migrationLockRetries: 3,
        connectionLimits: { app: 20, owner: 4 },
        prismaRoot: DEFAULT_PRISMA_ROOT,
      },
    });
  });

  it('reads every variable of the root .env.example', () => {
    const result = parseToolEnvironment({
      APP_ENV: 'ci',
      PLATFORM_MIGRATION_URL: PLATFORM,
      PROVISIONER_DATABASE_URL:
        'postgresql://medibooker_provisioner:changeme-provisioner@127.0.0.1:5432/postgres',
      DATABASE_ADMIN_URL: 'postgres://postgres:changeme-postgres@127.0.0.1:5432/postgres',
      DATABASE_CLUSTER_ENDPOINTS: '{"local":"db:5432"}',
      SECRET_STORE: 'dev',
      DEV_SECRET_SEED: 'changeme-dev-secret-seed',
      MARKETS: 'SA, DE',
      MIGRATION_CONCURRENCY: '8',
      MIGRATION_TIMEOUT_MS: '60000',
      MIGRATION_LOCK_RETRIES: '0',
      PRACTICE_APP_CONNECTION_LIMIT: '30',
      PRACTICE_OWNER_CONNECTION_LIMIT: '5',
      PRISMA_ROOT: 'schema',
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        appEnv: 'ci',
        secretStore: 'dev',
        clusterEndpoints: new Map([['local', { host: 'db', port: 5432 }]]),
        markets: ['SA', 'DE'],
        migrationConcurrency: 8,
        migrationTimeoutMs: 60_000,
        migrationLockRetries: 0,
        connectionLimits: { app: 30, owner: 5 },
        prismaRoot: path.resolve('schema'),
      },
    });
  });

  it('counts a blank value as unset', () => {
    const result = parseToolEnvironment({
      APP_ENV: 'local',
      PLATFORM_MIGRATION_URL: ' ',
      MIGRATION_CONCURRENCY: '',
      SECRET_STORE: '  ',
    });
    expect(result).toMatchObject({
      ok: true,
      value: { platformUrl: undefined, migrationConcurrency: 4, secretStore: undefined },
    });
  });

  it.each([
    [{}, ['APP_ENV']],
    [{ APP_ENV: 'dev' }, ['APP_ENV']],
    [{ APP_ENV: 'local', PLATFORM_MIGRATION_URL: 'http://127.0.0.1' }, ['PLATFORM_MIGRATION_URL']],
    [{ APP_ENV: 'local', PLATFORM_MIGRATION_URL: 'not a url' }, ['PLATFORM_MIGRATION_URL']],
    [{ APP_ENV: 'local', MIGRATION_CONCURRENCY: '1e3' }, ['MIGRATION_CONCURRENCY']],
    [{ APP_ENV: 'local', MIGRATION_CONCURRENCY: '+4' }, ['MIGRATION_CONCURRENCY']],
    [{ APP_ENV: 'local', MIGRATION_CONCURRENCY: '0' }, ['MIGRATION_CONCURRENCY']],
    [{ APP_ENV: 'local', MIGRATION_TIMEOUT_MS: '999' }, ['MIGRATION_TIMEOUT_MS']],
    [{ APP_ENV: 'local', MIGRATION_LOCK_RETRIES: '11' }, ['MIGRATION_LOCK_RETRIES']],
    [
      { APP_ENV: 'local', PRACTICE_OWNER_CONNECTION_LIMIT: '0' },
      ['PRACTICE_OWNER_CONNECTION_LIMIT'],
    ],
    [{ APP_ENV: 'local', MARKETS: 'SA,de' }, ['MARKETS']],
    [
      { APP_ENV: 'local', DATABASE_CLUSTER_ENDPOINTS: '{"local":"db"}' },
      ['DATABASE_CLUSTER_ENDPOINTS'],
    ],
    [{ APP_ENV: 'local', SECRET_STORE: 'vault' }, ['SECRET_STORE']],
    [{ APP_ENV: 'local', SECRET_STORE: 'dev' }, ['DEV_SECRET_SEED']],
  ])('rejects %j, naming %j', (source, invalidKeys) => {
    expect(parseToolEnvironment(source)).toEqual({ ok: false, invalidKeys });
  });

  it.each(['staging', 'production'])(
    'accepts the tools-only values and the development store only in local and ci, not %s',
    (appEnv) => {
      const result = parseToolEnvironment({
        APP_ENV: appEnv,
        PLATFORM_MIGRATION_URL: PLATFORM,
        PROVISIONER_DATABASE_URL: 'postgresql://medibooker_provisioner@db/postgres',
        DATABASE_ADMIN_URL: 'postgresql://postgres@db/postgres',
        DATABASE_CLUSTER_ENDPOINTS: '{"local":"db:5432"}',
        SECRET_STORE: 'dev',
        DEV_SECRET_SEED: 'changeme-dev-secret-seed',
      });
      expect(result).toEqual({
        ok: false,
        invalidKeys: [
          'PROVISIONER_DATABASE_URL',
          'DATABASE_ADMIN_URL',
          'DATABASE_CLUSTER_ENDPOINTS',
          'SECRET_STORE',
        ],
      });
    },
  );

  it('reports every invalid key of one run, never a value', () => {
    const result = parseToolEnvironment({
      APP_ENV: 'local',
      PLATFORM_MIGRATION_URL: 'ftp://changeme-secret-value@x',
      MIGRATION_LOCK_RETRIES: 'x',
      MARKETS: 'XYZ',
    });
    expect(result).toEqual({
      ok: false,
      invalidKeys: ['PLATFORM_MIGRATION_URL', 'MARKETS', 'MIGRATION_LOCK_RETRIES'],
    });
    expect(JSON.stringify(result)).not.toContain('changeme-secret-value');
  });
});

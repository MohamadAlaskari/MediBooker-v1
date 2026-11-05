import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnv, type EnvSource } from './env.schema.js';

/** A platform database URL for local and ci. */
const LOCAL_DATABASE_URL = 'postgresql://platform_app:pw@127.0.0.1:5432/medibooker_platform';

/** The platform database URL of a deployment: TLS with certificate and host-name checks. */
const DEPLOYED_DATABASE_URL =
  'postgresql://platform_app:pw@db.internal.test:5432/medibooker_platform?sslmode=verify-full&sslrootcert=/run/secrets/ca.pem';

const LOCAL: EnvSource = { APP_ENV: 'local', PLATFORM_DATABASE_URL: LOCAL_DATABASE_URL };

const CI: EnvSource = { ...LOCAL, APP_ENV: 'ci' };

const PRODUCTION: EnvSource = {
  APP_ENV: 'production',
  NODE_ENV: 'production',
  TRUST_PROXY_HOPS: '1',
  PLATFORM_DATABASE_URL: DEPLOYED_DATABASE_URL,
  MARKETS: 'SA',
};

const STAGING: EnvSource = { ...PRODUCTION, APP_ENV: 'staging' };

class ExitCalled extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super('process.exit was called');
  }
}

/** Runs parseEnv on an invalid source and returns the exit code and everything written to stderr. */
function parseInvalid(source: EnvSource): {
  code: string | number | null | undefined;
  stderr: string;
} {
  const written: string[] = [];
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new ExitCalled(code);
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  });
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof ExitCalled) return { code: error.code, stderr: written.join('') };
    throw error;
  }
  throw new Error('parseEnv accepted an invalid environment');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseEnv', () => {
  it('applies the 02 §7 defaults for a local environment', () => {
    expect(parseEnv(LOCAL)).toEqual({
      NODE_ENV: 'development',
      APP_ENV: 'local',
      PORT: 3001,
      HOST: '0.0.0.0',
      LOG_LEVEL: 'info',
      LOG_PRETTY: false,
      CORS_ORIGINS: [],
      TRUST_PROXY_HOPS: 0,
      OPENAPI_UI_ENABLED: false,
      RATE_LIMIT_PER_MINUTE: 120,
      PLATFORM_DATABASE_URL: LOCAL_DATABASE_URL,
      PLATFORM_DATABASE_POOL_MAX: 10,
      PRACTICE_POOL_MAX: 3,
      PRACTICE_CLIENTS_MAX: 40,
      PRACTICE_CLIENT_IDLE_MS: 60_000,
      PUBLIC_PRACTICE_CLIENTS_MAX: 10,
      JOB_PRACTICE_CLIENTS_MAX: 4,
      PRACTICE_CLIENT_CREATIONS_PER_SECOND: 5,
      PRACTICE_SECRET_TTL_MS: 600_000,
      DATABASE_CLUSTER_ENDPOINTS: new Map(),
      DATABASE_TX_MAX_WAIT_MS: 2000,
      DATABASE_TX_TIMEOUT_MS: 5000,
      MARKETS: [],
    });
  });

  it('reads the explicit values', () => {
    const env = parseEnv({
      ...CI,
      NODE_ENV: 'test',
      PORT: '4000',
      HOST: '127.0.0.1',
      LOG_LEVEL: 'debug',
      TRUST_PROXY_HOPS: '2',
      RATE_LIMIT_PER_MINUTE: '30',
    });
    expect(env).toMatchObject({
      APP_ENV: 'ci',
      NODE_ENV: 'test',
      PORT: 4000,
      HOST: '127.0.0.1',
      LOG_LEVEL: 'debug',
      TRUST_PROXY_HOPS: 2,
      RATE_LIMIT_PER_MINUTE: 30,
    });
  });

  it('ignores unknown keys, so the ambient environment never fails the parse', () => {
    expect(parseEnv({ ...LOCAL, PATH: '/usr/bin', SOMETHING_ELSE: 'x' })).not.toHaveProperty(
      'SOMETHING_ELSE',
    );
  });

  it('treats an empty value as unset', () => {
    const env = parseEnv({ ...LOCAL, PORT: '', TRUST_PROXY_HOPS: '', CORS_ORIGINS: '' });
    expect(env.PORT).toBe(3001);
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('treats a blank value as unset, never as 0', () => {
    const env = parseEnv({
      ...LOCAL,
      PORT: ' ',
      TRUST_PROXY_HOPS: '\t',
      CORS_ORIGINS: '\n',
    });
    expect(env.PORT).toBe(3001);
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('reads booleans strictly: "false" is false and "true" is true', () => {
    expect(parseEnv({ ...LOCAL, LOG_PRETTY: 'false' }).LOG_PRETTY).toBe(false);
    expect(parseEnv({ ...LOCAL, LOG_PRETTY: 'true' }).LOG_PRETTY).toBe(true);
    expect(parseInvalid({ ...LOCAL, LOG_PRETTY: '1' }).stderr).toContain('LOG_PRETTY');
    expect(parseInvalid({ ...LOCAL, OPENAPI_UI_ENABLED: 'TRUE' }).stderr).toContain(
      'OPENAPI_UI_ENABLED',
    );
  });

  it('rejects a missing APP_ENV instead of falling back to the least restrictive environment', () => {
    const result = parseInvalid({
      NODE_ENV: 'development',
      PLATFORM_DATABASE_URL: LOCAL_DATABASE_URL,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('APP_ENV (invalid_value)');
  });

  it.each(['0', '65536', '3.5', 'secret-value', '0x1', '1e3', '+3001', '-1', ' 3001'])(
    'rejects the port %j: integers are decimal digits only',
    (port) => {
      expect(parseInvalid({ ...LOCAL, PORT: port }).stderr).toContain('PORT (');
    },
  );

  it('reads an integer with leading zeros as decimal', () => {
    expect(parseEnv({ ...LOCAL, PORT: '03001' }).PORT).toBe(3001);
  });

  it('exits with code 1 and names the invalid keys, sorted, never their values', () => {
    const result = parseInvalid({
      APP_ENV: 'secret-value',
      PORT: 'secret-value',
      LOG_LEVEL: 'secret-value',
      CORS_ORIGINS: 'secret-value',
      PLATFORM_DATABASE_URL: LOCAL_DATABASE_URL,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain('secret-value');
    const keys = result.stderr
      .split('\n')
      .filter((line) => line.startsWith('  '))
      .map((line) => line.trim().split(' ')[0]);
    expect(keys).toEqual(['APP_ENV', 'CORS_ORIGINS', 'LOG_LEVEL', 'PORT']);
  });

  it('checks the rules that do not depend on APP_ENV also when APP_ENV is invalid', () => {
    const { stderr } = parseInvalid({
      APP_ENV: 'secret-value',
      NODE_ENV: 'production',
      LOG_PRETTY: 'true',
      PLATFORM_DATABASE_URL: LOCAL_DATABASE_URL,
    });
    expect(stderr).toContain('APP_ENV (invalid_value)');
    expect(stderr).toContain('LOG_PRETTY (custom: not_allowed_with_node_env_production)');
    expect(stderr).not.toContain('secret-value');
  });

  describe('LOG_PRETTY=true, which needs the devDependency pino-pretty', () => {
    it.each([
      ['production', PRODUCTION],
      ['staging', STAGING],
      ['the built image under APP_ENV=local', { ...LOCAL, NODE_ENV: 'production' }],
    ])('is rejected with NODE_ENV=production: %s', (_case, source) => {
      expect(parseInvalid({ ...source, LOG_PRETTY: 'true' }).stderr).toContain(
        'LOG_PRETTY (custom: not_allowed_with_node_env_production)',
      );
    });

    it('is accepted in development', () => {
      expect(parseEnv({ ...LOCAL, NODE_ENV: 'development', LOG_PRETTY: 'true' })).toMatchObject({
        LOG_PRETTY: true,
      });
    });
  });

  describe('CORS_ORIGINS', () => {
    it('reads a comma-separated list of origins', () => {
      expect(
        parseEnv({
          ...LOCAL,
          CORS_ORIGINS: 'https://web.example.test, http://localhost:3000',
        }).CORS_ORIGINS,
      ).toEqual(['https://web.example.test', 'http://localhost:3000']);
    });

    it.each([
      '*',
      'https://web.example.test/',
      'https://web.example.test/path',
      'web.example.test',
    ])('rejects %s, which is not an origin', (origin) => {
      expect(parseInvalid({ ...LOCAL, CORS_ORIGINS: origin }).stderr).toContain(
        'CORS_ORIGINS (custom: not_an_origin)',
      );
    });
  });

  describe('in production', () => {
    it('accepts a complete production environment', () => {
      expect(parseEnv({ ...PRODUCTION, CORS_ORIGINS: 'https://web.example.test' })).toMatchObject({
        APP_ENV: 'production',
        TRUST_PROXY_HOPS: 1,
        CORS_ORIGINS: ['https://web.example.test'],
      });
    });

    it('rejects OPENAPI_UI_ENABLED=true', () => {
      expect(parseInvalid({ ...PRODUCTION, OPENAPI_UI_ENABLED: 'true' }).stderr).toContain(
        'OPENAPI_UI_ENABLED (custom: not_allowed_in_production)',
      );
    });

    it('rejects LOG_PRETTY=true', () => {
      expect(parseInvalid({ ...PRODUCTION, LOG_PRETTY: 'true' }).stderr).toContain(
        'LOG_PRETTY (custom: not_allowed_with_node_env_production)',
      );
    });

    it.each([undefined, '', ' ', '\t'])(
      'rejects a missing TRUST_PROXY_HOPS, also when it is %j',
      (hops) => {
        expect(parseInvalid({ ...PRODUCTION, TRUST_PROXY_HOPS: hops }).stderr).toContain(
          'TRUST_PROXY_HOPS (custom: required_in_staging_and_production)',
        );
      },
    );

    it('requires NODE_ENV=production', () => {
      expect(parseInvalid({ ...PRODUCTION, NODE_ENV: 'development' }).stderr).toContain(
        'NODE_ENV (custom: production_required_in_staging_and_production)',
      );
    });

    it('rejects a CORS origin without https', () => {
      expect(
        parseInvalid({ ...PRODUCTION, CORS_ORIGINS: 'http://web.example.test' }).stderr,
      ).toContain('CORS_ORIGINS (custom: https_required_in_production)');
    });

    it('names every invalid key at once: a malformed PORT does not hide a missing TRUST_PROXY_HOPS', () => {
      const { code, stderr } = parseInvalid({
        ...PRODUCTION,
        TRUST_PROXY_HOPS: undefined,
        PORT: 'secret-value',
      });
      expect(code).toBe(1);
      expect(stderr).toContain('PORT (invalid_format)');
      expect(stderr).toContain('TRUST_PROXY_HOPS (custom: required_in_staging_and_production)');
      expect(stderr).not.toContain('secret-value');
    });

    it('checks the other rules when CORS_ORIGINS is not an origin, without reading its value', () => {
      const { stderr } = parseInvalid({
        ...PRODUCTION,
        CORS_ORIGINS: 'secret-value',
        LOG_PRETTY: 'true',
      });
      expect(stderr).toContain('CORS_ORIGINS (custom: not_an_origin)');
      expect(stderr).not.toContain('CORS_ORIGINS (custom: https_required_in_production)');
      expect(stderr).toContain('LOG_PRETTY (custom: not_allowed_with_node_env_production)');
      expect(stderr).not.toContain('secret-value');
    });
  });

  describe('in staging', () => {
    it('requires TRUST_PROXY_HOPS and NODE_ENV=production', () => {
      const { stderr } = parseInvalid({ ...STAGING, NODE_ENV: undefined, TRUST_PROXY_HOPS: '' });
      expect(stderr).toContain('TRUST_PROXY_HOPS (custom: required_in_staging_and_production)');
      expect(stderr).toContain('NODE_ENV (custom: production_required_in_staging_and_production)');
    });

    it('accepts a complete staging environment', () => {
      expect(parseEnv(STAGING)).toMatchObject({ APP_ENV: 'staging', TRUST_PROXY_HOPS: 1 });
    });
  });

  describe.each([
    ['staging', STAGING],
    ['production', PRODUCTION],
  ])('LOG_LEVEL and RATE_LIMIT_PER_MINUTE in %s', (_name, deployed) => {
    it.each(['fatal', 'silent'])(
      'rejects LOG_LEVEL=%s, which drops the error lines (02 §8)',
      (level) => {
        expect(parseInvalid({ ...deployed, LOG_LEVEL: level }).stderr).toContain(
          'LOG_LEVEL (custom: not_allowed_in_staging_and_production)',
        );
      },
    );

    it.each(['error', 'warn', 'info', 'debug', 'trace'])('accepts LOG_LEVEL=%s', (level) => {
      expect(parseEnv({ ...deployed, LOG_LEVEL: level })).toMatchObject({ LOG_LEVEL: level });
    });

    it('accepts a rate limit of 1000 and rejects 1001: a test value such as 100000 would switch throttling off', () => {
      expect(parseEnv({ ...deployed, RATE_LIMIT_PER_MINUTE: '1000' })).toMatchObject({
        RATE_LIMIT_PER_MINUTE: 1000,
      });
      for (const limit of ['1001', '100000']) {
        expect(parseInvalid({ ...deployed, RATE_LIMIT_PER_MINUTE: limit }).stderr).toContain(
          'RATE_LIMIT_PER_MINUTE (custom: at_most_1000_in_staging_and_production)',
        );
      }
    });

    it('names both rules and a malformed key in one run, without a value', () => {
      const { code, stderr } = parseInvalid({
        ...deployed,
        LOG_LEVEL: 'silent',
        RATE_LIMIT_PER_MINUTE: '100000',
        PORT: 'secret-value',
      });
      expect(code).toBe(1);
      expect(stderr).toContain('LOG_LEVEL (custom: not_allowed_in_staging_and_production)');
      expect(stderr).toContain(
        'RATE_LIMIT_PER_MINUTE (custom: at_most_1000_in_staging_and_production)',
      );
      expect(stderr).toContain('PORT (invalid_format)');
      expect(stderr).not.toContain('secret-value');
    });

    it.each(['DEBUG', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE'])(
      'rejects %s, whose output reaches stderr outside pino, also next to a malformed key',
      (key) => {
        const { code, stderr } = parseInvalid({ ...deployed, [key]: '*', PORT: 'secret-value' });
        expect(code).toBe(1);
        expect(stderr).toContain(`${key} (custom: not_allowed_in_staging_and_production)`);
        expect(stderr).toContain('PORT (invalid_format)');
        expect(stderr).not.toContain('secret-value');
      },
    );

    it('accepts a blank debug switch, which counts as unset', () => {
      expect(
        parseEnv({ ...deployed, DEBUG: '', NODE_DEBUG: ' ', NODE_DEBUG_NATIVE: '' }),
      ).toMatchObject({
        APP_ENV: deployed.APP_ENV,
      });
    });

    it('reports a malformed LOG_LEVEL or RATE_LIMIT_PER_MINUTE by its issue code only, without applying the rule', () => {
      const { stderr } = parseInvalid({
        ...deployed,
        LOG_LEVEL: 'secret-value',
        RATE_LIMIT_PER_MINUTE: 'secret-value',
      });
      expect(stderr).toContain('LOG_LEVEL (invalid_value)');
      expect(stderr).toContain('RATE_LIMIT_PER_MINUTE (invalid_format)');
      expect(stderr).not.toContain('custom');
      expect(stderr).not.toContain('secret-value');
    });
  });

  it('accepts the debug switches in local and ci and keeps them out of Env', () => {
    for (const base of [LOCAL, CI]) {
      const switches = { DEBUG: 'express:*', NODE_DEBUG: 'http', NODE_DEBUG_NATIVE: 'http2' };
      const env = parseEnv({ ...base, ...switches });
      for (const key of Object.keys(switches)) expect(env).not.toHaveProperty(key);
    }
  });

  it('leaves LOG_LEVEL=silent and a rate limit of 100000 to local and ci, as the tests use them', () => {
    for (const base of [LOCAL, CI]) {
      expect(
        parseEnv({ ...base, LOG_LEVEL: 'silent', RATE_LIMIT_PER_MINUTE: '100000' }),
      ).toMatchObject({ LOG_LEVEL: 'silent', RATE_LIMIT_PER_MINUTE: 100000 });
    }
  });

  it('applies neither rule when APP_ENV itself is malformed', () => {
    const { stderr } = parseInvalid({
      APP_ENV: 'secret-value',
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      RATE_LIMIT_PER_MINUTE: '100000',
      PLATFORM_DATABASE_URL: LOCAL_DATABASE_URL,
    });
    expect(stderr).toContain('APP_ENV (invalid_value)');
    expect(stderr).not.toContain('LOG_LEVEL');
    expect(stderr).not.toContain('RATE_LIMIT_PER_MINUTE');
  });
});

describe('parseEnv: the database keys (F04, 02 §7)', () => {
  describe('PLATFORM_DATABASE_URL', () => {
    it.each([undefined, '', ' '])('is required, also when it is %j', (url) => {
      expect(parseInvalid({ ...LOCAL, PLATFORM_DATABASE_URL: url }).stderr).toContain(
        'PLATFORM_DATABASE_URL (invalid_type)',
      );
    });

    it.each([
      'secret-value',
      'mysql://user:example-secret-value@127.0.0.1:3306/db',
      'postgresql://',
      'postgresql:///medibooker_platform',
    ])('rejects %s, which is not a PostgreSQL URL with a host, without showing it', (url) => {
      const { stderr } = parseInvalid({ ...LOCAL, PLATFORM_DATABASE_URL: url });
      expect(stderr).toContain('PLATFORM_DATABASE_URL (custom: not_a_postgres_url)');
      expect(stderr).not.toContain('secret-value');
    });

    it('accepts the postgres: and postgresql: schemes without TLS in local and ci', () => {
      for (const base of [LOCAL, CI]) {
        for (const url of [LOCAL_DATABASE_URL, 'postgres://platform_app:pw@db:5432/platform']) {
          expect(parseEnv({ ...base, PLATFORM_DATABASE_URL: url }).PLATFORM_DATABASE_URL).toBe(url);
        }
      }
    });

    describe.each([
      ['staging', STAGING],
      ['production', PRODUCTION],
    ])('in %s', (_name, deployed) => {
      it.each([
        ['no TLS parameters', LOCAL_DATABASE_URL],
        ['sslmode=require', `${LOCAL_DATABASE_URL}?sslmode=require&sslrootcert=/ca.pem`],
        ['verify-full without sslrootcert', `${LOCAL_DATABASE_URL}?sslmode=verify-full`],
        [
          'verify-full with an empty sslrootcert',
          `${LOCAL_DATABASE_URL}?sslmode=verify-full&sslrootcert=`,
        ],
      ])('rejects a URL with %s, also next to a malformed key', (_case, url) => {
        const { stderr } = parseInvalid({
          ...deployed,
          PLATFORM_DATABASE_URL: url,
          PORT: 'secret-value',
        });
        expect(stderr).toContain(
          'PLATFORM_DATABASE_URL (custom: verify_full_required_outside_local_and_ci)',
        );
        expect(stderr).toContain('PORT (invalid_format)');
        expect(stderr).not.toContain('secret-value');
      });

      it('accepts sslmode=verify-full with sslrootcert', () => {
        expect(parseEnv(deployed).PLATFORM_DATABASE_URL).toBe(DEPLOYED_DATABASE_URL);
      });

      it('reports a malformed URL by its own reason only, without applying the TLS rule', () => {
        const { stderr } = parseInvalid({ ...deployed, PLATFORM_DATABASE_URL: 'secret-value' });
        expect(stderr).toContain('PLATFORM_DATABASE_URL (custom: not_a_postgres_url)');
        expect(stderr).not.toContain('verify_full_required');
        expect(stderr).not.toContain('secret-value');
      });
    });
  });

  describe.each([
    ['PLATFORM_DATABASE_POOL_MAX', '25', 25, '0'],
    ['PRACTICE_POOL_MAX', '12', 12, '0'],
    ['PRACTICE_CLIENTS_MAX', '2', 2, '0'],
    ['PRACTICE_CLIENT_IDLE_MS', '1000', 1000, '999'],
    ['PUBLIC_PRACTICE_CLIENTS_MAX', '1', 1, '0'],
    ['JOB_PRACTICE_CLIENTS_MAX', '1', 1, '0'],
    ['PRACTICE_CLIENT_CREATIONS_PER_SECOND', '1', 1, '0'],
    ['PRACTICE_SECRET_TTL_MS', '0', 0, '86400001'],
    ['DATABASE_TX_MAX_WAIT_MS', '100', 100, '0'],
    ['DATABASE_TX_TIMEOUT_MS', '100', 100, '0'],
  ])('%s', (key, raw, value, outOfRange) => {
    it(`reads ${raw} as ${String(value)}`, () => {
      expect(parseEnv({ ...LOCAL, [key]: raw })).toMatchObject({ [key]: value });
    });

    it.each([outOfRange, '0x1', '1e3', '-1', 'secret-value'])(
      'rejects %j: decimal digits within range only',
      (invalid) => {
        const { stderr } = parseInvalid({ ...LOCAL, [key]: invalid });
        expect(stderr).toContain(`${key} (`);
        expect(stderr).not.toContain('secret-value');
      },
    );
  });

  describe('DATABASE_CLUSTER_ENDPOINTS', () => {
    it('reads a JSON map from cluster id to host:port', () => {
      const env = parseEnv({
        ...CI,
        DATABASE_CLUSTER_ENDPOINTS:
          '{"local":"db:5432","eu-central-1":"127.0.0.1:6543","v6":"[::1]:5432"}',
      });
      expect(env.DATABASE_CLUSTER_ENDPOINTS).toEqual(
        new Map([
          ['local', { host: 'db', port: 5432 }],
          ['eu-central-1', { host: '127.0.0.1', port: 6543 }],
          ['v6', { host: '::1', port: 5432 }],
        ]),
      );
    });

    it.each(['secret-value', '[]', '"db:5432"', 'null', '{"local":'])(
      'rejects %j, which is not a JSON object, without showing it',
      (value) => {
        const { stderr } = parseInvalid({ ...LOCAL, DATABASE_CLUSTER_ENDPOINTS: value });
        expect(stderr).toContain('DATABASE_CLUSTER_ENDPOINTS (custom: not_a_json_object)');
        expect(stderr).not.toContain('secret-value');
      },
    );

    it.each([
      '{"Local":"db:5432"}',
      '{"__proto__":"db:5432"}',
      '{"local":"db"}',
      '{"local":"db:0"}',
      '{"local":"db:65536"}',
      '{"local":"secret-value:5432/x"}',
      '{"local":5432}',
    ])('rejects %s, which maps something else than a cluster id to host:port', (value) => {
      const { stderr } = parseInvalid({ ...LOCAL, DATABASE_CLUSTER_ENDPOINTS: value });
      expect(stderr).toContain('DATABASE_CLUSTER_ENDPOINTS (custom: not_a_cluster_endpoint_map)');
      expect(stderr).not.toContain('secret-value');
    });

    describe.each([
      ['staging', STAGING],
      ['production', PRODUCTION],
    ])('in %s', (_name, deployed) => {
      it('is rejected, also next to a malformed key', () => {
        const { stderr } = parseInvalid({
          ...deployed,
          DATABASE_CLUSTER_ENDPOINTS: '{"local":"db:5432"}',
          PORT: 'secret-value',
        });
        expect(stderr).toContain('DATABASE_CLUSTER_ENDPOINTS (custom: only_in_local_and_ci)');
        expect(stderr).toContain('PORT (invalid_format)');
        expect(stderr).not.toContain('secret-value');
      });

      it('is accepted blank, which counts as unset', () => {
        expect(parseEnv({ ...deployed, DATABASE_CLUSTER_ENDPOINTS: ' ' })).toMatchObject({
          DATABASE_CLUSTER_ENDPOINTS: new Map(),
        });
      });

      it('reports a malformed value by its own reason only', () => {
        const { stderr } = parseInvalid({
          ...deployed,
          DATABASE_CLUSTER_ENDPOINTS: 'secret-value',
        });
        expect(stderr).toContain('DATABASE_CLUSTER_ENDPOINTS (custom: not_a_json_object)');
        expect(stderr).not.toContain('only_in_local_and_ci');
      });
    });
  });

  describe('SECRET_STORE and DEV_SECRET_SEED', () => {
    it('accepts the development store with its seed in local and ci', () => {
      for (const base of [LOCAL, CI]) {
        expect(parseEnv({ ...base, SECRET_STORE: 'dev', DEV_SECRET_SEED: 'seed' })).toMatchObject({
          SECRET_STORE: 'dev',
          DEV_SECRET_SEED: 'seed',
        });
      }
    });

    it('leaves the store unset by default, in every environment', () => {
      expect(parseEnv(LOCAL)).not.toHaveProperty('SECRET_STORE');
      expect(parseEnv(PRODUCTION)).not.toHaveProperty('SECRET_STORE');
    });

    it.each([undefined, '', ' '])(
      'requires the seed with the development store, also when it is %j, next to a malformed key',
      (seed) => {
        const { stderr } = parseInvalid({
          ...CI,
          SECRET_STORE: 'dev',
          DEV_SECRET_SEED: seed,
          PORT: 'secret-value',
        });
        expect(stderr).toContain('DEV_SECRET_SEED (custom: required_with_secret_store_dev)');
        expect(stderr).toContain('PORT (invalid_format)');
        expect(stderr).not.toContain('secret-value');
      },
    );

    it.each(['vault', 'secret-value', 'DEV'])(
      'rejects SECRET_STORE=%j: only dev exists until OPS01',
      (store) => {
        const { stderr } = parseInvalid({ ...CI, SECRET_STORE: store, DEV_SECRET_SEED: 'seed' });
        expect(stderr).toContain('SECRET_STORE (invalid_value)');
        expect(stderr).not.toContain('secret-value');
      },
    );

    describe.each([
      ['staging', STAGING],
      ['production', PRODUCTION],
    ])('in %s', (_name, deployed) => {
      it('rejects the development store, also next to a malformed key', () => {
        const { stderr } = parseInvalid({
          ...deployed,
          SECRET_STORE: 'dev',
          DEV_SECRET_SEED: 'seed',
          PORT: 'secret-value',
        });
        expect(stderr).toContain('SECRET_STORE (custom: dev_only_in_local_and_ci)');
        expect(stderr).toContain('PORT (invalid_format)');
        expect(stderr).not.toContain('secret-value');
      });
    });
  });

  describe('MARKETS', () => {
    it('reads comma-separated ISO 3166-1 alpha-2 codes', () => {
      expect(parseEnv({ ...LOCAL, MARKETS: 'SA, DE' }).MARKETS).toEqual(['SA', 'DE']);
    });

    it.each(['sa', 'SAU', 'S1', 'secret-value'])(
      'rejects %j, which is not an upper-case alpha-2 code',
      (value) => {
        const { stderr } = parseInvalid({ ...LOCAL, MARKETS: value });
        expect(stderr).toContain('MARKETS (custom: not_a_market_list)');
        expect(stderr).not.toContain('secret-value');
      },
    );

    it('is optional in local and ci', () => {
      expect(parseEnv(CI).MARKETS).toEqual([]);
    });

    describe.each([
      ['staging', STAGING],
      ['production', PRODUCTION],
    ])('in %s', (_name, deployed) => {
      it.each([undefined, '', ' , '])(
        'is required, also when it is %j, next to a malformed key',
        (value) => {
          const { stderr } = parseInvalid({ ...deployed, MARKETS: value, PORT: 'secret-value' });
          expect(stderr).toContain('MARKETS (custom: required_in_staging_and_production)');
          expect(stderr).toContain('PORT (invalid_format)');
          expect(stderr).not.toContain('secret-value');
        },
      );

      it('reports a malformed value by its own reason only', () => {
        const { stderr } = parseInvalid({ ...deployed, MARKETS: 'secret-value' });
        expect(stderr).toContain('MARKETS (custom: not_a_market_list)');
        expect(stderr).not.toContain('required_in_staging_and_production');
      });
    });
  });
});

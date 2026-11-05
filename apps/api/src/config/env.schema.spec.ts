import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnv, type EnvSource } from './env.schema.js';

const PRODUCTION: EnvSource = {
  APP_ENV: 'production',
  NODE_ENV: 'production',
  TRUST_PROXY_HOPS: '1',
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
    expect(parseEnv({ APP_ENV: 'local' })).toEqual({
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
    });
  });

  it('reads the explicit values', () => {
    const env = parseEnv({
      APP_ENV: 'ci',
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
    expect(
      parseEnv({ APP_ENV: 'local', PATH: '/usr/bin', SOMETHING_ELSE: 'x' }),
    ).not.toHaveProperty('SOMETHING_ELSE');
  });

  it('treats an empty value as unset', () => {
    const env = parseEnv({ APP_ENV: 'local', PORT: '', TRUST_PROXY_HOPS: '', CORS_ORIGINS: '' });
    expect(env.PORT).toBe(3001);
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('treats a blank value as unset, never as 0', () => {
    const env = parseEnv({
      APP_ENV: 'local',
      PORT: ' ',
      TRUST_PROXY_HOPS: '\t',
      CORS_ORIGINS: '\n',
    });
    expect(env.PORT).toBe(3001);
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('reads booleans strictly: "false" is false and "true" is true', () => {
    expect(parseEnv({ APP_ENV: 'local', LOG_PRETTY: 'false' }).LOG_PRETTY).toBe(false);
    expect(parseEnv({ APP_ENV: 'local', LOG_PRETTY: 'true' }).LOG_PRETTY).toBe(true);
    expect(parseInvalid({ APP_ENV: 'local', LOG_PRETTY: '1' }).stderr).toContain('LOG_PRETTY');
    expect(parseInvalid({ APP_ENV: 'local', OPENAPI_UI_ENABLED: 'TRUE' }).stderr).toContain(
      'OPENAPI_UI_ENABLED',
    );
  });

  it('rejects a missing APP_ENV instead of falling back to the least restrictive environment', () => {
    const result = parseInvalid({ NODE_ENV: 'development' });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('APP_ENV (invalid_value)');
  });

  it.each(['0', '65536', '3.5', 'secret-value', '0x1', '1e3', '+3001', '-1', ' 3001'])(
    'rejects the port %j: integers are decimal digits only',
    (port) => {
      expect(parseInvalid({ APP_ENV: 'local', PORT: port }).stderr).toContain('PORT (');
    },
  );

  it('reads an integer with leading zeros as decimal', () => {
    expect(parseEnv({ APP_ENV: 'local', PORT: '03001' }).PORT).toBe(3001);
  });

  it('exits with code 1 and names the invalid keys, sorted, never their values', () => {
    const result = parseInvalid({
      APP_ENV: 'secret-value',
      PORT: 'secret-value',
      LOG_LEVEL: 'secret-value',
      CORS_ORIGINS: 'secret-value',
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
    });
    expect(stderr).toContain('APP_ENV (invalid_value)');
    expect(stderr).toContain('LOG_PRETTY (custom: not_allowed_with_node_env_production)');
    expect(stderr).not.toContain('secret-value');
  });

  describe('LOG_PRETTY=true, which needs the devDependency pino-pretty', () => {
    it.each([
      ['production', PRODUCTION],
      ['staging', { APP_ENV: 'staging', NODE_ENV: 'production', TRUST_PROXY_HOPS: '1' }],
      ['the built image under APP_ENV=local', { APP_ENV: 'local', NODE_ENV: 'production' }],
    ])('is rejected with NODE_ENV=production: %s', (_case, source) => {
      expect(parseInvalid({ ...source, LOG_PRETTY: 'true' }).stderr).toContain(
        'LOG_PRETTY (custom: not_allowed_with_node_env_production)',
      );
    });

    it('is accepted in development', () => {
      expect(
        parseEnv({ APP_ENV: 'local', NODE_ENV: 'development', LOG_PRETTY: 'true' }),
      ).toMatchObject({ LOG_PRETTY: true });
    });
  });

  describe('CORS_ORIGINS', () => {
    it('reads a comma-separated list of origins', () => {
      expect(
        parseEnv({
          APP_ENV: 'local',
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
      expect(parseInvalid({ APP_ENV: 'local', CORS_ORIGINS: origin }).stderr).toContain(
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
      const { stderr } = parseInvalid({ APP_ENV: 'staging' });
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
    for (const appEnv of ['local', 'ci']) {
      const switches = { DEBUG: 'express:*', NODE_DEBUG: 'http', NODE_DEBUG_NATIVE: 'http2' };
      const env = parseEnv({ APP_ENV: appEnv, ...switches });
      for (const key of Object.keys(switches)) expect(env).not.toHaveProperty(key);
    }
  });

  it('leaves LOG_LEVEL=silent and a rate limit of 100000 to local and ci, as the tests use them', () => {
    for (const appEnv of ['local', 'ci']) {
      expect(
        parseEnv({ APP_ENV: appEnv, LOG_LEVEL: 'silent', RATE_LIMIT_PER_MINUTE: '100000' }),
      ).toMatchObject({ LOG_LEVEL: 'silent', RATE_LIMIT_PER_MINUTE: 100000 });
    }
  });

  it('applies neither rule when APP_ENV itself is malformed', () => {
    const { stderr } = parseInvalid({
      APP_ENV: 'secret-value',
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      RATE_LIMIT_PER_MINUTE: '100000',
    });
    expect(stderr).toContain('APP_ENV (invalid_value)');
    expect(stderr).not.toContain('LOG_LEVEL');
    expect(stderr).not.toContain('RATE_LIMIT_PER_MINUTE');
  });
});

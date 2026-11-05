import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_ENV } from '../../test/support/test-env.js';
import type { PlatformPrismaService } from '../common/database/platform-prisma.service.js';
import { type Env, parseEnv } from '../config/env.schema.js';
import { PLATFORM_SCHEMA_REQUIRED } from '../generated/schema-versions.js';
import { ReadinessService } from './readiness.service.js';

function setUp(env: Env = parseEnv(TEST_ENV)) {
  const platform = {
    assertReachable: vi.fn().mockResolvedValue(undefined),
    schemaVersion: vi.fn().mockResolvedValue(PLATFORM_SCHEMA_REQUIRED),
  };
  return {
    readiness: new ReadinessService(platform as unknown as PlatformPrismaService, env),
    platform,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ReadinessService (02 §10)', () => {
  it('is ready when the platform database answers and its schema has reached PLATFORM_SCHEMA_REQUIRED', async () => {
    const { readiness, platform } = setUp();
    await expect(readiness.assertReady()).resolves.toBeUndefined();
    platform.schemaVersion.mockResolvedValue('20991231235959_newer');
    await expect(readiness.assertReady()).resolves.toBeUndefined();
  });

  it('is not ready while the platform database refuses connections', async () => {
    const { readiness, platform } = setUp();
    platform.assertReachable.mockRejectedValue(new Error('refused'));
    await expect(readiness.assertReady()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('is not ready while the platform schema is behind the code, or not migrated at all', async () => {
    const { readiness, platform } = setUp();
    platform.schemaVersion.mockResolvedValueOnce('20260101000000_older');
    await expect(readiness.assertReady()).rejects.toBeInstanceOf(ServiceUnavailableException);
    platform.schemaVersion.mockResolvedValueOnce(undefined);
    await expect(readiness.assertReady()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('is not ready when the platform database does not answer within one second', async () => {
    vi.useFakeTimers();
    const { readiness, platform } = setUp();
    platform.assertReachable.mockReturnValue(new Promise(() => undefined));
    const outcome = readiness.assertReady().then(
      () => 'ready',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(999);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBeInstanceOf(ServiceUnavailableException);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is not ready once shutdown has begun', async () => {
    const { readiness, platform } = setUp();
    readiness.beforeApplicationShutdown();
    await expect(readiness.assertReady()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(platform.assertReachable).not.toHaveBeenCalled();
  });

  it('is not ready in staging or production without MARKETS, which parseEnv also refuses', async () => {
    const env = parseEnv(TEST_ENV);
    for (const appEnv of ['staging', 'production'] as const) {
      const { readiness } = setUp({ ...env, APP_ENV: appEnv, MARKETS: [] });
      await expect(readiness.assertReady()).rejects.toBeInstanceOf(ServiceUnavailableException);
      const { readiness: withMarkets } = setUp({ ...env, APP_ENV: appEnv, MARKETS: ['SA'] });
      await expect(withMarkets.assertReady()).resolves.toBeUndefined();
    }
  });
});

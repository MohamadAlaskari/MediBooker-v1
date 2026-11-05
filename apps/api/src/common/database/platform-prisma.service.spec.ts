import { describe, expect, it } from 'vitest';
import { fakePinoLogger } from '../../../test/support/fake-pino-logger.js';
import { TEST_ENV } from '../../../test/support/test-env.js';
import { parseEnv } from '../../config/env.schema.js';
import { PlatformPrismaService } from './platform-prisma.service.js';

// TEST_ENV's platform database is a port that refuses every connection.
const env = parseEnv(TEST_ENV);

describe('PlatformPrismaService', () => {
  it('connects to nothing while it is built (02 §8): the pool opens on the first query', async () => {
    const { logger, calls } = fakePinoLogger();
    const platform = new PlatformPrismaService(env, logger);
    expect(calls).toEqual([]);
    await platform.onModuleDestroy();
  });

  it('assertReachable rejects when the database refuses, and Prisma error events are logged with a constant message only', async () => {
    const { logger, calls, setContext } = fakePinoLogger();
    const platform = new PlatformPrismaService(env, logger);
    try {
      await expect(platform.assertReachable()).rejects.toMatchObject({ code: 'P2010' });
      expect(calls).toEqual([
        { level: 'error', fields: 'platform database error', message: undefined },
      ]);
      expect(setContext).toHaveBeenCalledWith('PlatformPrismaService');
    } finally {
      await platform.onModuleDestroy();
    }
  });
});

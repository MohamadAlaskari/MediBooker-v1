import { getTransactionHostToken, TransactionHost } from '@nestjs-cls/transactional';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it } from 'vitest';
import { TEST_ENV } from '../test/support/test-env.js';
import { AppModule } from './app.module.js';
import { PlatformPrismaService } from './common/database/platform-prisma.service.js';
import { SecretStore } from './common/database/secret-store.js';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter.js';
import { AuthenticationGuard } from './common/security/authentication.guard.js';
import { PracticeConnectionManager } from './common/tenancy/practice-connection-manager.js';
import { Clock } from './common/time/clock.js';
import { SystemClock } from './common/time/system-clock.js';
import { ENV } from './config/env.module.js';
import { parseEnv } from './config/env.schema.js';

describe('AppModule', () => {
  it('RT-47 compiles AppModule.forRoot(parseEnv(TEST_ENV)) and resolves AuthenticationGuard', async () => {
    const env = parseEnv(TEST_ENV);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();
    try {
      expect(moduleRef.get(AuthenticationGuard)).toBeInstanceOf(AuthenticationGuard);
      expect(moduleRef.get(ENV)).toBe(env);
      // Nest injects by type from decorator metadata; without it the filter's logger is undefined.
      const filterParameterTypes: unknown = Reflect.getMetadata(
        'design:paramtypes',
        ProblemDetailsFilter,
      );
      expect(filterParameterTypes).toEqual([PinoLogger]);
    } finally {
      await moduleRef.close();
    }
  });

  it('F04 wires the data layer without touching a database: both transaction hosts, the platform client, the secret store, the connection manager and the SystemClock', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(parseEnv(TEST_ENV))],
    }).compile();
    try {
      for (const connection of ['platform', 'practice']) {
        expect(
          moduleRef.get(getTransactionHostToken(connection), { strict: false }),
        ).toBeInstanceOf(TransactionHost);
      }
      // Prisma's client constructor returns a proxy of the instance, so `instanceof` is false for
      // it; the subclass's methods are reached through the proxy.
      const platform = moduleRef.get(PlatformPrismaService, { strict: false });
      expect(typeof platform.assertReachable).toBe('function');
      expect(typeof platform.schemaVersion).toBe('function');
      expect(moduleRef.get(SecretStore, { strict: false })).toBeInstanceOf(SecretStore);
      expect(moduleRef.get(PracticeConnectionManager, { strict: false })).toBeInstanceOf(
        PracticeConnectionManager,
      );
      expect(moduleRef.get(Clock, { strict: false })).toBeInstanceOf(SystemClock);
    } finally {
      await moduleRef.close();
    }
  });
});

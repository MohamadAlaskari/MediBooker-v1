import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it } from 'vitest';
import { TEST_ENV } from '../test/support/test-env.js';
import { AppModule } from './app.module.js';
import { UnknownExceptionFilter } from './common/logging/unknown-exception.filter.js';
import { AuthenticationGuard } from './common/security/authentication.guard.js';
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
        UnknownExceptionFilter,
      );
      expect(filterParameterTypes).toEqual([PinoLogger]);
    } finally {
      await moduleRef.close();
    }
  });
});

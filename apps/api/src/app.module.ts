import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { pinoOptions } from './common/logging/pino-options.js';
import { UnknownExceptionFilter } from './common/logging/unknown-exception.filter.js';
import { AuthenticationGuard } from './common/security/authentication.guard.js';
import { throttlers } from './common/security/throttlers.js';
import { EnvModule } from './config/env.module.js';
import type { Env } from './config/env.schema.js';
import { HealthModule } from './health/health.module.js';

export interface AppModuleOptions {
  /** Where logs go; only createTestApp sets it, to capture or discard them. Default: stdout. */
  logDestination?: DestinationStream;
}

/**
 * The root module, built from the environment that main.ts (or a test) parsed. There is no
 * configuration module: nothing reads `process.env` after main.ts (02 §3).
 */
@Module({})
export class AppModule {
  static forRoot(env: Env, options: AppModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EnvModule.forRoot(env),
        LoggerModule.forRoot(pinoOptions(env, options.logDestination)),
        // Mounted by hand as the first middleware in configureApp (`middleware.mount` is false).
        ClsModule.forRoot({ global: true }),
        ThrottlerModule.forRoot(throttlers(env)),
        HealthModule,
      ],
      providers: [
        // Global guards run in this order: rate limit first, then authentication.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        AuthenticationGuard,
        { provide: APP_GUARD, useExisting: AuthenticationGuard },
        // Until X01's ProblemDetailsFilter: logs unknown exceptions without their message.
        { provide: APP_FILTER, useClass: UnknownExceptionFilter },
      ],
    };
  }
}

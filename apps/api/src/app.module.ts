import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { PlatformDatabaseModule } from './common/database/platform-database.module.js';
import { platformTransactionalPlugin } from './common/database/platform-transactional.js';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter.js';
import { createValidationPipe } from './common/errors/validation.js';
import { NoStoreInterceptor } from './common/http/no-store.interceptor.js';
import { pinoOptions } from './common/logging/pino-options.js';
import { AuthenticationGuard } from './common/security/authentication.guard.js';
import { throttlers } from './common/security/throttlers.js';
import { practiceTransactionalPlugin } from './common/tenancy/practice-transactional.adapter.js';
import { TenancyModule } from './common/tenancy/tenancy.module.js';
import { TimeModule } from './common/time/time.module.js';
import { EnvModule } from './config/env.module.js';
import type { Env } from './config/env.schema.js';
import { HealthModule } from './health/health.module.js';
import { PublicPracticeModule } from './modules/public-practice/public-practice.module.js';
import { SchedulingModule } from './modules/scheduling/scheduling.module.js';

export interface AppModuleOptions {
  /** Where logs go; only createTestApp sets it, to capture or discard them. Default: stdout. */
  logDestination?: DestinationStream;
}

/**
 * The root module, built from the environment that main.ts (or a test) parsed. There is no
 * configuration module: nothing reads `process.env` after main.ts or a command of cli/ (02 §3).
 */
@Module({})
export class AppModule {
  static forRoot(env: Env, options: AppModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EnvModule.forRoot(env),
        LoggerModule.forRoot(pinoOptions(env, options.logDestination)),
        TimeModule,
        // Mounted by hand as the first middleware in configureApp (`middleware.mount` is false).
        // The plugins give the `platform` and `practice` transaction hosts (02 §5).
        ClsModule.forRoot({
          global: true,
          plugins: [platformTransactionalPlugin(), practiceTransactionalPlugin(env)],
        }),
        ThrottlerModule.forRoot(throttlers(env)),
        PlatformDatabaseModule,
        TenancyModule,
        HealthModule,
        PublicPracticeModule,
        SchedulingModule,
      ],
      providers: [
        // Global guards run in this order: rate limit first, then authentication.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        AuthenticationGuard,
        { provide: APP_GUARD, useExisting: AuthenticationGuard },
        { provide: APP_PIPE, useFactory: createValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: NoStoreInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}

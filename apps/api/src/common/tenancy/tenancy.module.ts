import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PlatformDatabaseModule } from '../database/platform-database.module.js';
import { PracticeCache } from './practice-cache.js';
import { PracticeClientFactory } from './practice-client.js';
import { PracticeClientOpener } from './practice-client-opener.js';
import { PracticeConnectionManager } from './practice-connection-manager.js';
import { PracticeConnectionMetrics } from './practice-connection-metrics.js';
import { PracticeContextInterceptor } from './practice-context.interceptor.js';
import { PracticeResolver } from './practice-resolver.js';
import { PracticeRunner } from './practice-runner.js';
import { PracticeSecrets } from './practice-secrets.js';

/**
 * The tenancy layer (02 §5): the connection manager, practice resolution for
 * `@PracticeScoped()` routes through the global PracticeContextInterceptor, `runInPractice`,
 * `forEachPractice` and the PracticeCache.
 */
@Module({
  imports: [PlatformDatabaseModule],
  providers: [
    PracticeCache,
    PracticeClientFactory,
    PracticeClientOpener,
    PracticeConnectionManager,
    PracticeConnectionMetrics,
    PracticeResolver,
    PracticeRunner,
    PracticeSecrets,
    { provide: APP_INTERCEPTOR, useClass: PracticeContextInterceptor },
  ],
  exports: [PracticeCache, PracticeConnectionManager, PracticeRunner],
})
export class TenancyModule {}

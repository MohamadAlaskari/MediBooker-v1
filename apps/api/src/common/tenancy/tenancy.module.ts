import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PlatformDatabaseModule } from '../database/platform-database.module.js';
import { IntegrationRelay } from './integration-relay.js';
import { PracticeAccessIndex } from './practice-access-index.js';
import { PracticeAudit } from './practice-audit.js';
import { PracticeCache } from './practice-cache.js';
import { PracticeClientFactory } from './practice-client.js';
import { PracticeClientOpener } from './practice-client-opener.js';
import { PracticeConnectionManager } from './practice-connection-manager.js';
import { PracticeConnectionMetrics } from './practice-connection-metrics.js';
import { PracticeContextInterceptor } from './practice-context.interceptor.js';
import { PracticeKeys } from './practice-keys.js';
import { PracticeResolver } from './practice-resolver.js';
import { PracticeRunner } from './practice-runner.js';
import { PracticeSecrets } from './practice-secrets.js';
import { PublishedPractices } from './published-practices.js';

/**
 * The tenancy layer (02 §5): the connection manager, practice resolution for
 * `@PracticeScoped()` routes through the global PracticeContextInterceptor, `runInPractice`,
 * `forEachPractice` and the PracticeCache.
 */
@Module({
  imports: [PlatformDatabaseModule],
  providers: [
    IntegrationRelay,
    PracticeAccessIndex,
    PracticeAudit,
    PracticeCache,
    PracticeClientFactory,
    PracticeClientOpener,
    PracticeConnectionManager,
    PracticeConnectionMetrics,
    PracticeKeys,
    PracticeResolver,
    PracticeRunner,
    PracticeSecrets,
    PublishedPractices,
    { provide: APP_INTERCEPTOR, useClass: PracticeContextInterceptor },
  ],
  exports: [
    IntegrationRelay,
    PracticeAccessIndex,
    PracticeAudit,
    PracticeCache,
    PracticeConnectionManager,
    PracticeKeys,
    PracticeRunner,
    PublishedPractices,
  ],
})
export class TenancyModule {}

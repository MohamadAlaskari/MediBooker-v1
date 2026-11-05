import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PinoLogger } from 'nestjs-pino';
import type { RequestContext } from '../context/request-context.js';
import { isUuid } from '../context/request-id.js';
import { isConnectionFailure } from '../database/prisma-errors.js';
import { PracticeConnectionManager } from './practice-connection-manager.js';
import { PracticeUnavailableError } from './practice-errors.js';
import { PracticeResolver } from './practice-resolver.js';
import {
  type PracticePurpose,
  type PracticeRoute,
  type ResolvedPractice,
  resolvedPracticeOf,
} from './practice-route.js';

/** What `forEachPractice` did: practices that ran and practices that failed or were skipped. */
export interface PracticeRunSummary {
  readonly succeeded: number;
  readonly failed: number;
}

/**
 * The only way into a practice outside an HTTP request (02 §5, ADR 0005 §2.5): jobs, the
 * fan-out of B03, export and saga steps, the integration relay, provider callbacks and realtime
 * joins.
 */
@Injectable()
export class PracticeRunner {
  constructor(
    private readonly resolver: PracticeResolver,
    private readonly connections: PracticeConnectionManager,
    private readonly cls: ClsService<RequestContext>,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(PracticeRunner.name);
  }

  /**
   * Runs `fn` in a fresh request context with the practice resolved and its client leased: the
   * registry row, the status table for the purpose (jobs only for ACTIVE practices), the market
   * check and the schema guard first. A practice that cannot be served, or whose connection fails
   * in `fn`, throws PracticeUnavailableError, which callers record.
   */
  runInPractice<T>(
    practiceId: string,
    fn: (practice: ResolvedPractice) => Promise<T>,
    options: { readonly purpose: PracticePurpose },
  ): Promise<T> {
    return this.cls.run({ ifNested: 'override' }, async () => {
      const route = await this.routeOf(practiceId, options.purpose);
      const lease = await this.connections.acquire(route, options.purpose);
      try {
        const practice = resolvedPracticeOf(route);
        this.cls.set('practice', { practice, lease });
        return await fn(practice);
      } catch (error) {
        if (!isConnectionFailure(error)) throw error;
        this.connections.close(lease);
        throw new PracticeUnavailableError(route.id, 'PRACTICE_CONNECTION_FAILED', {
          cause: error,
        });
      } finally {
        lease.release();
      }
    });
  }

  /**
   * Runs `fn` for every ACTIVE practice of the registry with purpose `job`, at most `concurrency`
   * at a time, each through `runInPractice`. A practice that fails is logged and counted; the
   * others continue.
   */
  async forEachPractice(
    fn: (practice: ResolvedPractice) => Promise<void>,
    options: { readonly concurrency: number },
  ): Promise<PracticeRunSummary> {
    const queue = await this.resolver.activePracticeIds();
    let succeeded = 0;
    let failed = 0;
    const work = async (): Promise<void> => {
      for (let practiceId = queue.shift(); practiceId !== undefined; practiceId = queue.shift()) {
        try {
          await this.runInPractice(practiceId, fn, { purpose: 'job' });
          succeeded += 1;
        } catch (error) {
          failed += 1;
          this.logFailure(practiceId, error);
        }
      }
    };
    const workers = Math.max(1, Math.min(options.concurrency, queue.length));
    await Promise.all(Array.from({ length: workers }, work));
    return { succeeded, failed };
  }

  private async routeOf(practiceId: string, purpose: PracticePurpose): Promise<PracticeRoute> {
    if (!isUuid(practiceId)) throw new PracticeUnavailableError(practiceId, 'PRACTICE_NOT_FOUND');
    const resolution = await this.resolver.resolve(practiceId.toLowerCase(), purpose);
    if (resolution.answer === 'SERVE') return resolution.route;
    const reason = resolution.answer === 'NOT_FOUND' ? 'PRACTICE_NOT_FOUND' : resolution.reason;
    throw new PracticeUnavailableError(practiceId, reason);
  }

  private logFailure(practiceId: string, error: unknown): void {
    if (error instanceof PracticeUnavailableError) {
      this.logger.warn({ practiceId, reasonCode: error.reason }, 'practice job skipped');
    } else {
      this.logger.error({ err: error, practiceId }, 'practice job failed');
    }
  }
}

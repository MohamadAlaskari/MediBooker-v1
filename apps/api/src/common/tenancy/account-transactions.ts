import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import type { RequestContext } from '../context/request-context.js';
import { DomainException } from '../errors/domain.exception.js';
import { requirePracticeContext } from './practice-context.js';
import type { PracticeTransactionHost } from './practice-transactional.adapter.js';

/** What is under way ends soon: at the latest with its wait for a lock. */
const RETRY_AFTER_SECONDS = 1;

/**
 * Transactions of one account that wait for row locks in a practice database. All of a person's
 * bookings wait for one patient row, and each holds one of the practice's few connections meanwhile,
 * so a burst by one person would take them from everyone else: at least one stays free for others,
 * and more than that at a time is 429 before a connection is taken. Per instance, like the pool.
 *
 * A wait for a lock ends after DATABASE_LOCK_TIMEOUT_MS, because the limit on a transaction does not
 * end it; PracticeContextInterceptor answers that with 503.
 */
@Injectable()
export class AccountTransactions {
  private readonly underWay = new Map<string, number>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async run<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const key = `${requirePracticeContext(this.cls).practice.id}:${userId}`;
    const running = this.underWay.get(key) ?? 0;
    if (running >= Math.max(1, this.env.PRACTICE_POOL_MAX - 1)) {
      throw new DomainException('RATE_LIMITED', { retryAfterSeconds: RETRY_AFTER_SECONDS });
    }
    this.underWay.set(key, running + 1);
    try {
      return await this.txHost.withTransaction(async () => {
        const lockWait = `${String(this.env.DATABASE_LOCK_TIMEOUT_MS)}ms`;
        await this.txHost.tx.$executeRaw`SELECT set_config('lock_timeout', ${lockWait}, true)`;
        return work();
      });
    } finally {
      this.leave(key);
    }
  }

  private leave(key: string): void {
    const left = (this.underWay.get(key) ?? 1) - 1;
    if (left === 0) this.underWay.delete(key);
    else this.underWay.set(key, left);
  }
}

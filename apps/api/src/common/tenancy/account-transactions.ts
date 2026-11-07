import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import type { RequestContext } from '../context/request-context.js';
import { requirePracticeContext } from './practice-context.js';
import type { PracticeTransactionHost } from './practice-transactional.adapter.js';
import { RunningLimit } from './running-limit.js';

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
  private readonly underWay = new RunningLimit();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  run<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const key = `${requirePracticeContext(this.cls).practice.id}:${userId}`;
    const limit = Math.max(1, this.env.PRACTICE_POOL_MAX - 1);
    return this.underWay.run(key, limit, () =>
      this.txHost.withTransaction(async () => {
        const lockWait = `${String(this.env.DATABASE_LOCK_TIMEOUT_MS)}ms`;
        await this.txHost.tx.$executeRaw`SELECT set_config('lock_timeout', ${lockWait}, true)`;
        return work();
      }),
    );
  }
}

import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import type { PlatformTransactionHost } from '../../common/database/platform-transactional.js';
import { PlatformAudit } from '../../common/security/platform-audit.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf } from '../../common/time/convert.js';

export const UNCONFIRMED_ACCOUNTS_JOB = 'unconfirmed-accounts';
const KEPT_DAYS = 7;
const BATCH_SIZE = 500;
const SYSTEM_ACTOR = 'system';

/**
 * Deletes accounts nobody confirmed within 7 days, with their details: what was entered may belong to
 * someone else, and a mistyped address must not keep a person's data for a stranger (RT-90).
 */
@Injectable()
export class UnconfirmedAccountsJob {
  constructor(
    @InjectTransactionHost('platform') private readonly txHost: PlatformTransactionHost,
    private readonly clock: Clock,
    private readonly audit: PlatformAudit,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(UnconfirmedAccountsJob.name);
  }

  /**
   * The number of accounts it deleted, batch by batch: a big backlog must not exceed the limit of one
   * transaction and roll everything back, night after night. A row someone holds waits for the next
   * run.
   */
  async run(): Promise<number> {
    const before = dbInstantOf(this.clock.now().subtract({ hours: KEPT_DAYS * 24 }));
    let deleted = 0;
    let batch: number;
    do {
      batch = await this.deleteBatch(before);
      deleted += batch;
    } while (batch === BATCH_SIZE);
    return deleted;
  }

  private async deleteBatch(before: Date): Promise<number> {
    return this.txHost.withTransaction(async () => {
      const count = await this.txHost.tx.$executeRaw`
        DELETE FROM users
        WHERE id IN (
          SELECT id FROM users
          WHERE email_verified_at IS NULL AND created_at < ${before}
          ORDER BY created_at
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )`;
      if (count > 0) {
        await this.audit.record({
          actor: SYSTEM_ACTOR,
          action: 'auth.account.expire',
          outcome: 'SUCCEEDED',
        });
      }
      return count;
    });
  }

  /** A run nobody waits for. Never rejects: the database may be away for the moment. */
  @Cron('30 1 * * *', { name: UNCONFIRMED_ACCOUNTS_JOB, timeZone: 'UTC' })
  async runInBackground(): Promise<void> {
    try {
      this.logger.info({ succeeded: await this.run() }, 'unconfirmed accounts deleted');
    } catch (error) {
      this.logger.error({ err: error }, 'unconfirmed accounts not deleted');
    }
  }
}

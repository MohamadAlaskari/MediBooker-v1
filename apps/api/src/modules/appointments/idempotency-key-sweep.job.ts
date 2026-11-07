import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { PracticeRunner, type PracticeRunSummary } from '../../common/tenancy/practice-runner.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf } from '../../common/time/convert.js';
import { IDEMPOTENCY_HOURS } from './domain/booking.rules.js';

export const IDEMPOTENCY_KEY_SWEEP_JOB = 'idempotency-key-sweep';

/** A few at a time: every practice has its own database, and they share one connection budget. */
const CONCURRENCY = 4;

/**
 * Removes the keys that answer no more. A booking removes only its own caller's, and a key's hash can
 * be of a note, so none stays once it has done its work, also for someone who never books again.
 */
@Injectable()
export class IdempotencyKeySweepJob {
  constructor(
    private readonly runner: PracticeRunner,
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly clock: Clock,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(IdempotencyKeySweepJob.name);
  }

  /** One run over all practices; a practice that fails is logged and does not stop the others. */
  async run(): Promise<PracticeRunSummary> {
    const expired = dbInstantOf(this.clock.now().subtract({ hours: IDEMPOTENCY_HOURS }));
    const summary = await this.runner.forEachPractice(
      async () => {
        await this.txHost.tx.idempotencyKey.deleteMany({ where: { createdAt: { lt: expired } } });
      },
      { concurrency: CONCURRENCY },
    );
    this.logger.info(summary, 'idempotency key sweep finished');
    return summary;
  }

  /** A run nobody waits for. Never rejects: the platform database may be away for the moment. */
  @Cron('30 1 * * *', { name: IDEMPOTENCY_KEY_SWEEP_JOB, timeZone: 'UTC' })
  async runInBackground(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.logger.error({ err: error }, 'idempotency key sweep failed');
    }
  }
}

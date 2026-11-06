import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { PracticeRunner, type PracticeRunSummary } from '../../common/tenancy/practice-runner.js';
import { SlotGenerationService } from './slot-generation.service.js';

export const SLOT_GENERATION_JOB = 'slot-generation';

/** A few at a time: every practice has its own database, and they share one connection budget. */
const CONCURRENCY = 4;

/**
 * Keeps every active practice's slots filled up to its horizon: at night and at every start, for a
 * night the instance was down. Several instances only repeat work, because generation is idempotent.
 */
@Injectable()
export class SlotGenerationJob {
  constructor(
    private readonly runner: PracticeRunner,
    private readonly slots: SlotGenerationService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(SlotGenerationJob.name);
  }

  /** One run over all practices; a practice that fails is logged and does not stop the others. */
  async run(): Promise<PracticeRunSummary> {
    const summary = await this.runner.forEachPractice(
      async () => {
        await this.slots.generate();
      },
      { concurrency: CONCURRENCY },
    );
    this.logger.info(summary, 'slot generation finished');
    return summary;
  }

  /** A run nobody waits for. Never rejects: the platform database may be away for the moment. */
  @Cron('0 1 * * *', { name: SLOT_GENERATION_JOB, timeZone: 'UTC' })
  async runInBackground(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.logger.error({ err: error }, 'slot generation failed');
    }
  }
}

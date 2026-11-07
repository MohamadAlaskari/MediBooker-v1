import { InjectTransactionHost } from '@nestjs-cls/transactional';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { Clock } from '../time/clock.js';
import { dbInstantOf } from '../time/convert.js';
import { type AccessChange, PracticeAccessIndex } from './practice-access-index.js';
import { type PracticeRunSummary, PracticeRunner } from './practice-runner.js';
import type { PracticeTransactionHost } from './practice-transactional.adapter.js';

const ACCESS_CHANGED = 'ACCESS_CHANGED';
const BATCH_SIZE = 100;
const CONCURRENCY = 4;
/** How often a practice whose write-through failed is tried again, without visiting the others. */
const RETRY_SECONDS = 30;

const accessChange = z.object({
  userId: z.uuid(),
  capacity: z.enum(['STAFF', 'PATIENT']),
  active: z.boolean(),
});

/**
 * Keeps the membership index behind the practice databases (ADR 0005 §1.4). A change writes an event
 * into its practice's outbox in its own transaction; the handler then applies it at once, and this
 * relay is what guarantees it. An event names no practice: the relay takes the practice from the
 * database it read the event from, so one practice's rows cannot change another's index.
 *
 * A visit opens a practice's client, and creations are a budget public requests share. So a practice
 * whose write-through failed is tried again soon, and all of them only every RELAY_POLL_SECONDS.
 */
@Injectable()
export class IntegrationRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private sweepTimer: NodeJS.Timeout | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly failed = new Set<string>();

  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly runner: PracticeRunner,
    private readonly index: PracticeAccessIndex,
    private readonly clock: Clock,
    private readonly logger: PinoLogger,
    @Inject(ENV) private readonly env: Env,
  ) {
    logger.setContext(IntegrationRelay.name);
  }

  onApplicationBootstrap(): void {
    if (this.env.RELAY_POLL_SECONDS === 0) return;
    this.sweepTimer = setInterval(() => {
      void this.poll(() => this.run());
    }, this.env.RELAY_POLL_SECONDS * 1000);
    this.sweepTimer.unref();
    this.retryTimer = setInterval(() => {
      void this.poll(() => this.retryFailed());
    }, RETRY_SECONDS * 1000);
    this.retryTimer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.sweepTimer);
    clearInterval(this.retryTimer);
  }

  /** In the caller's transaction of the current practice; its id is the version of the change. */
  async recordAccessChange(change: AccessChange): Promise<bigint> {
    const { id } = await this.txHost.tx.integrationOutbox.create({
      data: { type: ACCESS_CHANGED, payload: { ...change } },
      select: { id: true },
    });
    return id;
  }

  /**
   * After the commit, to shorten the lag. It never fails the request: the change is committed, and
   * the relay applies it soon.
   */
  async applyNow(practiceId: string, version: bigint, change: AccessChange): Promise<void> {
    try {
      await this.index.apply(practiceId, version, change);
      await this.markProcessed(version);
    } catch (error) {
      this.failed.add(practiceId);
      this.logger.warn({ err: error, practiceId }, 'membership index not updated at once');
    }
  }

  /** One run over every active practice: what the timer runs, and what the tests drive. */
  run(): Promise<PracticeRunSummary> {
    return this.runner.forEachPractice(
      async ({ id }) => {
        await this.relayPractice(id);
      },
      { concurrency: CONCURRENCY },
    );
  }

  /** Only the practices whose write-through failed. One that fails again stays on the list. */
  async retryFailed(): Promise<void> {
    const practices = [...this.failed];
    this.failed.clear();
    for (const practiceId of practices) {
      try {
        await this.runner.runInPractice(practiceId, ({ id }) => this.relayPractice(id), {
          purpose: 'job',
        });
      } catch (error) {
        this.failed.add(practiceId);
        this.logger.warn({ err: error, practiceId }, 'membership index not updated on retry');
      }
    }
  }

  /** One run nobody waits for. Never rejects, and never overlaps with itself. */
  private async poll(work: () => Promise<unknown>): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await work();
    } catch (error) {
      this.logger.error({ err: error }, 'membership index relay failed');
    } finally {
      this.running = false;
    }
  }

  private async relayPractice(practiceId: string): Promise<void> {
    let after = 0n;
    for (;;) {
      const events = await this.txHost.tx.integrationOutbox.findMany({
        where: { processedAt: null, type: ACCESS_CHANGED, id: { gt: after } },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, payload: true },
      });
      for (const { id, payload } of events) {
        after = id;
        const change = accessChange.safeParse(payload);
        if (change.success) {
          await this.index.apply(practiceId, id, change.data);
          await this.markProcessed(id);
        } else {
          // Stays for code that can read it, such as a newer version during a rollout, and the
          // reading goes on past it, so that it keeps no good event from its turn.
          this.logger.error({ practiceId }, 'integration event refused');
        }
      }
      if (events.length < BATCH_SIZE) return;
    }
  }

  private async markProcessed(id: bigint): Promise<void> {
    await this.txHost.tx.integrationOutbox.updateMany({
      where: { id, processedAt: null },
      data: { processedAt: dbInstantOf(this.clock.now()) },
    });
  }
}

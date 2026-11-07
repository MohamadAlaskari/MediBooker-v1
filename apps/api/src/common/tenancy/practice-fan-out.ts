import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { PracticeUnavailableError } from './practice-errors.js';
import type { ResolvedPractice } from './practice-route.js';
import { PracticeRunner } from './practice-runner.js';
import { RunningLimit } from './running-limit.js';

export const FAN_OUT_REASONS = ['UNAVAILABLE', 'TIMEOUT', 'LIMIT'] as const;
export type FanOutReason = (typeof FAN_OUT_REASONS)[number];

export interface FanOutMiss {
  readonly practiceId: string;
  readonly reason: FanOutReason;
}

/** What loaded, and which practices did not: nobody should mistake one for all. */
export interface FanOutResult<T> {
  readonly items: readonly T[];
  readonly unavailable: readonly FanOutMiss[];
}

type Reader<T> = (practice: ResolvedPractice) => Promise<readonly T[]>;

const TIMED_OUT = Symbol('timed out');

/**
 * Reads from several practice databases for one account's request (ADR 0005 §9.1): the first
 * ME_FANOUT_MAX_PRACTICES in the order given, ME_FANOUT_CONCURRENCY at a time, each within
 * ME_FANOUT_TIMEOUT_MS and in its own request context through `runInPractice`, with a client budget
 * of its own, so that a request for one practice keeps its client and its turn to create one.
 *
 * A reader that outlasts its time keeps its lease until it ends. So once as many have timed out as
 * can run at once, the rest are named without being opened: stalled databases cost fewer than two
 * rounds of leases, and a person waits two timeouts at most for them. One fan-out at a time per
 * account, because the limit per address does not see an account with many addresses.
 */
@Injectable()
export class PracticeFanOut {
  private readonly underWay = new RunningLimit();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly runner: PracticeRunner,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(PracticeFanOut.name);
  }

  read<T>(
    accountId: string,
    practiceIds: readonly string[],
    reader: Reader<T>,
  ): Promise<FanOutResult<T>> {
    return this.underWay.run(accountId, 1, () => this.fanOut(practiceIds, reader));
  }

  private async fanOut<T>(
    practiceIds: readonly string[],
    reader: Reader<T>,
  ): Promise<FanOutResult<T>> {
    const limit = this.env.ME_FANOUT_MAX_PRACTICES;
    const concurrency = this.env.ME_FANOUT_CONCURRENCY;
    const queue = practiceIds.slice(0, limit);
    const items: T[] = [];
    const unavailable: FanOutMiss[] = [];
    let timeouts = 0;
    const work = async (): Promise<void> => {
      for (let practiceId = queue.shift(); practiceId !== undefined; practiceId = queue.shift()) {
        if (timeouts >= concurrency) {
          unavailable.push({ practiceId, reason: 'TIMEOUT' });
          continue;
        }
        const answer = await this.branch(practiceId, reader);
        if (answer === 'TIMEOUT') timeouts += 1;
        if (typeof answer === 'string') unavailable.push({ practiceId, reason: answer });
        else items.push(...answer);
      }
    };
    const workers = Math.min(concurrency, queue.length);
    await Promise.all(Array.from({ length: workers }, work));
    for (const practiceId of practiceIds.slice(limit)) {
      unavailable.push({ practiceId, reason: 'LIMIT' });
    }
    return { items, unavailable };
  }

  private async branch<T>(
    practiceId: string,
    reader: Reader<T>,
  ): Promise<readonly T[] | FanOutReason> {
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => {
        resolve(TIMED_OUT);
      }, this.env.ME_FANOUT_TIMEOUT_MS);
    });
    // A lease that arrives too late goes back unused: nobody waits for what it would read.
    const run = this.runner.runInPractice(
      practiceId,
      (practice) => (timedOut ? Promise.resolve<readonly T[]>([]) : reader(practice)),
      { purpose: 'fanOut' },
    );
    try {
      const answer = await Promise.race([run, timeout]);
      if (answer !== TIMED_OUT) return answer;
      timedOut = true;
      this.logger.warn(
        { practiceId, reasonCode: 'FANOUT_TIMEOUT' },
        'practice left out of a fan-out',
      );
      run.catch((error: unknown) => {
        this.logFailure(practiceId, error);
      });
      return 'TIMEOUT';
    } catch (error) {
      this.logFailure(practiceId, error);
      return 'UNAVAILABLE';
    } finally {
      clearTimeout(timer);
    }
  }

  private logFailure(practiceId: string, error: unknown): void {
    if (error instanceof PracticeUnavailableError) {
      this.logger.warn({ practiceId, reasonCode: error.reason }, 'practice left out of a fan-out');
    } else {
      this.logger.error({ err: error, practiceId }, 'practice failed in a fan-out');
    }
  }
}

import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { PracticeRunner } from '../../common/tenancy/practice-runner.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { FixedClock } from '../../common/time/fixed-clock.js';
import { IdempotencyKeySweepJob } from './idempotency-key-sweep.job.js';

const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');

function setUp(forEachPractice: PracticeRunner['forEachPractice']) {
  const logger = { setContext: vi.fn(), info: vi.fn(), error: vi.fn() };
  const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const job = new IdempotencyKeySweepJob(
    { forEachPractice } as unknown as PracticeRunner,
    { tx: { idempotencyKey: { deleteMany } } } as unknown as PracticeTransactionHost,
    new FixedClock(NOW),
    logger as unknown as PinoLogger,
  );
  return { job, logger, deleteMany };
}

describe('IdempotencyKeySweepJob', () => {
  it('removes what is older than 24 hours in each practice, and reports the summary', async () => {
    const { job, deleteMany, logger } = setUp(async (work) => {
      await work({} as never);
      await work({} as never);
      return { succeeded: 2, failed: 0 };
    });
    await expect(job.run()).resolves.toEqual({ succeeded: 2, failed: 0 });
    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date('2026-11-14T07:00:00Z') } },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { succeeded: 2, failed: 0 },
      'idempotency key sweep finished',
    );
  });

  it('never rejects in the background: the platform database may be away for the moment', async () => {
    const { job, logger } = setUp(() => Promise.reject(new Error('refused')));
    await expect(job.runInBackground()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';
import type { PracticeRunner } from '../../common/tenancy/practice-runner.js';
import { SlotGenerationJob } from './slot-generation.job.js';
import type { SlotGenerationService } from './slot-generation.service.js';

function setUp(forEachPractice: PracticeRunner['forEachPractice']) {
  const logger = { setContext: vi.fn(), info: vi.fn(), error: vi.fn() };
  const slots = { generate: vi.fn(() => Promise.resolve({ created: 1, removed: 0 })) };
  const job = new SlotGenerationJob(
    { forEachPractice } as unknown as PracticeRunner,
    slots as unknown as SlotGenerationService,
    logger as unknown as PinoLogger,
  );
  return { job, logger, slots };
}

describe('SlotGenerationJob', () => {
  it('generates in the context of each practice and reports the summary', async () => {
    const { job, slots, logger } = setUp(async (work) => {
      await work({} as never);
      await work({} as never);
      return { succeeded: 2, failed: 0 };
    });
    await expect(job.run()).resolves.toEqual({ succeeded: 2, failed: 0 });
    expect(slots.generate).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      { succeeded: 2, failed: 0 },
      'slot generation finished',
    );
  });

  it('never rejects in the background: the platform database may be away for the moment', async () => {
    const { job, logger } = setUp(() => Promise.reject(new Error('refused')));
    await expect(job.runInBackground()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

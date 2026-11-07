import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakePinoLogger } from '../../../test/support/fake-pino-logger.js';
import type { Env } from '../../config/env.schema.js';
import { FixedClock } from '../time/fixed-clock.js';
import { IntegrationRelay } from './integration-relay.js';
import type { AccessChange, PracticeAccessIndex } from './practice-access-index.js';
import type { PracticeRunner } from './practice-runner.js';
import type { PracticeTransactionHost } from './practice-transactional.adapter.js';

const PRACTICE = '00000000-0000-4000-8000-00000000000a';
const USER = '00000000-0000-4000-8000-000000000001';
const CHANGE: AccessChange = { userId: USER, capacity: 'PATIENT', active: true };
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');

interface Event {
  readonly id: bigint;
  readonly payload: unknown;
}

function setUp(events: readonly Event[] = [], env: Partial<Env> = { RELAY_POLL_SECONDS: 0 }) {
  const outbox = {
    create: vi.fn().mockResolvedValue({ id: 7n }),
    findMany: vi.fn().mockResolvedValue(events),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const txHost = { tx: { integrationOutbox: outbox } } as unknown as PracticeTransactionHost;
  const forEachPractice = vi.fn(
    async (run: (practice: { id: string }) => Promise<void>): Promise<object> => {
      await run({ id: PRACTICE });
      return { succeeded: 1, failed: 0 };
    },
  );
  const runInPractice = vi.fn(
    async (id: string, run: (practice: { id: string }) => Promise<void>): Promise<void> => {
      await run({ id });
    },
  );
  const runner = { forEachPractice, runInPractice } as unknown as PracticeRunner;
  const apply = vi.fn().mockResolvedValue(undefined);
  const index = { apply } as unknown as PracticeAccessIndex;
  const { logger, calls } = fakePinoLogger();
  const relay = new IntegrationRelay(
    txHost,
    runner,
    index,
    new FixedClock(NOW),
    logger,
    env as Env,
  );
  return { relay, outbox, apply, forEachPractice, runInPractice, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('IntegrationRelay (ADR 0005 §1.4)', () => {
  it('writes an event without a practice, whose id is the version', async () => {
    const { relay, outbox } = setUp();
    await expect(relay.recordAccessChange(CHANGE)).resolves.toBe(7n);
    expect(outbox.create).toHaveBeenCalledWith({
      data: { type: 'ACCESS_CHANGED', payload: CHANGE },
      select: { id: true },
    });
  });

  it('applies a change after the commit, and marks it as done', async () => {
    const { relay, apply, outbox } = setUp();
    await relay.applyNow(PRACTICE, 7n, CHANGE);
    expect(apply).toHaveBeenCalledWith(PRACTICE, 7n, CHANGE);
    expect(outbox.updateMany).toHaveBeenCalledWith({
      where: { id: 7n, processedAt: null },
      data: { processedAt: new Date(NOW.epochMilliseconds) },
    });
  });

  it('never fails a request after the commit, and leaves the event for its next run', async () => {
    const { relay, apply, outbox, calls } = setUp();
    apply.mockRejectedValue(new Error('platform away'));
    await expect(relay.applyNow(PRACTICE, 7n, CHANGE)).resolves.toBeUndefined();
    expect(outbox.updateMany).not.toHaveBeenCalled();
    const logged = JSON.stringify(calls);
    expect(logged).toContain(PRACTICE);
    expect(logged).not.toContain(USER);
  });

  it('applies what is due in its order, with the practice it read them from', async () => {
    const { relay, apply, outbox } = setUp([
      { id: 1n, payload: CHANGE },
      { id: 2n, payload: { ...CHANGE, active: false } },
    ]);
    await relay.run();
    expect(outbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { processedAt: null, type: 'ACCESS_CHANGED', id: { gt: 0n } },
      }),
    );
    expect(apply.mock.calls).toEqual([
      [PRACTICE, 1n, CHANGE],
      [PRACTICE, 2n, { ...CHANGE, active: false }],
    ]);
    expect(outbox.updateMany).toHaveBeenCalledTimes(2);
  });

  it('takes a practice from its context even when an event names another', async () => {
    const { relay, apply } = setUp([
      { id: 1n, payload: { ...CHANGE, practiceId: 'somewhere-else' } },
    ]);
    await relay.run();
    expect(apply).toHaveBeenCalledWith(PRACTICE, 1n, CHANGE);
  });

  it('reads on past a full batch, so that no event waits behind a refused one', async () => {
    const { relay, apply, outbox } = setUp();
    const full = Array.from({ length: 100 }, (_, index) => ({
      id: BigInt(index + 1),
      payload: { unreadable: true },
    }));
    outbox.findMany
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([{ id: 101n, payload: CHANGE }]);
    await relay.run();
    expect(outbox.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { processedAt: null, type: 'ACCESS_CHANGED', id: { gt: 100n } },
      }),
    );
    expect(apply.mock.calls).toEqual([[PRACTICE, 101n, CHANGE]]);
  });

  it('tries only a practice whose write-through failed, until it works', async () => {
    const { relay, apply, forEachPractice, runInPractice } = setUp();
    apply.mockRejectedValueOnce(new Error('platform away'));
    await relay.applyNow(PRACTICE, 7n, CHANGE);

    runInPractice.mockRejectedValueOnce(new Error('still away'));
    await relay.retryFailed();
    expect(runInPractice).toHaveBeenCalledTimes(1);

    await relay.retryFailed();
    expect(runInPractice).toHaveBeenCalledTimes(2);
    expect(runInPractice).toHaveBeenLastCalledWith(PRACTICE, expect.any(Function), {
      purpose: 'job',
    });

    await relay.retryFailed();
    expect(runInPractice).toHaveBeenCalledTimes(2);
    expect(forEachPractice).not.toHaveBeenCalled();
  });

  it('refuses a broken event without showing it, and goes on with the good ones', async () => {
    const { relay, apply, outbox, calls } = setUp([
      { id: 1n, payload: { userId: 'not-a-uuid', number: 'A123456789' } },
      { id: 2n, payload: CHANGE },
    ]);
    await relay.run();
    expect(apply.mock.calls).toEqual([[PRACTICE, 2n, CHANGE]]);
    // It stays for code that can read it: only the good one is done.
    expect(outbox.updateMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(calls)).not.toContain('A123456789');
  });

  it('starts no timer with 0, and stops the one it started', () => {
    vi.useFakeTimers();
    const off = setUp([], { RELAY_POLL_SECONDS: 0 });
    off.relay.onApplicationBootstrap();
    expect(vi.getTimerCount()).toBe(0);

    const on = setUp([], { RELAY_POLL_SECONDS: 900 });
    on.relay.onApplicationBootstrap();
    expect(vi.getTimerCount()).toBe(2);
    on.relay.onApplicationShutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs on its timer, never overlaps with itself, and survives a failure', async () => {
    vi.useFakeTimers();
    const { relay, forEachPractice, runInPractice, apply, calls } = setUp([], {
      RELAY_POLL_SECONDS: 60,
    });
    let finish: (() => void) | undefined;
    forEachPractice.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve({ succeeded: 1, failed: 0 });
          };
        }),
    );
    relay.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(forEachPractice).toHaveBeenCalledTimes(1);
    finish?.();
    await vi.advanceTimersByTimeAsync(0);

    forEachPractice.mockRejectedValueOnce(new Error('registry away'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(forEachPractice).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(calls)).toContain('membership index relay failed');

    // Between the sweeps only what failed.
    apply.mockRejectedValueOnce(new Error('platform away'));
    await relay.applyNow(PRACTICE, 7n, CHANGE);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runInPractice).toHaveBeenCalledTimes(1);
    relay.onApplicationShutdown();
  });
});

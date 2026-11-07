import type { PinoLogger } from 'nestjs-pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.schema.js';
import { PracticeUnavailableError } from './practice-errors.js';
import { PracticeFanOut } from './practice-fan-out.js';
import type { ResolvedPractice } from './practice-route.js';
import type { PracticeRunner } from './practice-runner.js';

const TIMEOUT_MS = 2000;
const CONCURRENCY = 4;
const ENV = {
  ME_FANOUT_MAX_PRACTICES: 20,
  ME_FANOUT_CONCURRENCY: CONCURRENCY,
  ME_FANOUT_TIMEOUT_MS: TIMEOUT_MS,
} as Env;
const ACCOUNT = 'account';
const PRACTICE = {} as ResolvedPractice;

type Reader = (practice: ResolvedPractice) => Promise<readonly string[]>;

function setUp(runInPractice: (practiceId: string, reader: Reader) => Promise<readonly string[]>) {
  const logger = { setContext: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const fanOut = new PracticeFanOut(
    ENV,
    { runInPractice } as unknown as PracticeRunner,
    logger as unknown as PinoLogger,
  );
  return { fanOut, logger };
}

const reader: Reader = () => Promise.resolve([]);
const practicesCalled = (count: number): readonly string[] =>
  Array.from({ length: count }, (_, index) => `practice-${String(index)}`);

describe('PracticeFanOut (ADR 0005 §9.1)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('joins what each practice answers, through runInPractice with a budget of its own', async () => {
    const runInPractice = vi.fn((practiceId: string) => Promise.resolve([`item of ${practiceId}`]));
    const { fanOut } = setUp(runInPractice);
    await expect(fanOut.read(ACCOUNT, ['a', 'b'], reader)).resolves.toEqual({
      items: ['item of a', 'item of b'],
      unavailable: [],
    });
    expect(runInPractice).toHaveBeenCalledWith('a', expect.any(Function), { purpose: 'fanOut' });
  });

  it('answers for no practice without asking anyone', async () => {
    const runInPractice = vi.fn();
    const { fanOut } = setUp(runInPractice);
    await expect(fanOut.read(ACCOUNT, [], reader)).resolves.toEqual({ items: [], unavailable: [] });
    expect(runInPractice).not.toHaveBeenCalled();
  });

  it('lists a practice that cannot be served, logs its reason, and returns the others', async () => {
    const { fanOut, logger } = setUp((practiceId) =>
      practiceId === 'b'
        ? Promise.reject(new PracticeUnavailableError('b', 'PRACTICE_CONNECTION_FAILED'))
        : Promise.resolve(['item of a']),
    );
    await expect(fanOut.read(ACCOUNT, ['a', 'b'], reader)).resolves.toEqual({
      items: ['item of a'],
      unavailable: [{ practiceId: 'b', reason: 'UNAVAILABLE' }],
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { practiceId: 'b', reasonCode: 'PRACTICE_CONNECTION_FAILED' },
      'practice left out of a fan-out',
    );
  });

  it('also lists a practice that fails in another way, and logs that as an error', async () => {
    const failure = new Error('secret-value');
    const { fanOut, logger } = setUp(() => Promise.reject(failure));
    await expect(fanOut.read(ACCOUNT, ['a'], reader)).resolves.toEqual({
      items: [],
      unavailable: [{ practiceId: 'a', reason: 'UNAVAILABLE' }],
    });
    expect(logger.error).toHaveBeenCalledWith(
      { err: failure, practiceId: 'a' },
      'practice failed in a fan-out',
    );
  });

  it('lists a practice as TIMEOUT when its reader never answers, logs it, and does not wait', async () => {
    vi.useFakeTimers();
    const { fanOut, logger } = setUp((practiceId) =>
      practiceId === 'b' ? new Promise(() => undefined) : Promise.resolve(['item of a']),
    );
    const answer = fanOut.read(ACCOUNT, ['a', 'b'], reader);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    let settled = false;
    void answer.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(answer).resolves.toEqual({
      items: ['item of a'],
      unavailable: [{ practiceId: 'b', reason: 'TIMEOUT' }],
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { practiceId: 'b', reasonCode: 'FANOUT_TIMEOUT' },
      'practice left out of a fan-out',
    );
  });

  it('opens no more once as many have stalled as can run: the rest are named at once', async () => {
    vi.useFakeTimers();
    let opened = 0;
    const { fanOut } = setUp(() => {
      opened += 1;
      return new Promise(() => undefined);
    });
    const practices = practicesCalled(12);
    const answer = fanOut.read(ACCOUNT, practices, reader);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    // Each of the first round's timeouts but the last still started another reader.
    expect(opened).toBe(2 * CONCURRENCY - 1);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    const { unavailable } = await answer;
    expect(opened).toBe(2 * CONCURRENCY - 1);
    expect(unavailable.map(({ reason }) => reason)).toEqual(Array(12).fill('TIMEOUT'));
    expect(unavailable.map(({ practiceId }) => practiceId).toSorted()).toEqual(
      practices.toSorted(),
    );
  });

  it('does not read through a lease that arrives after the time is up', async () => {
    vi.useFakeTimers();
    const read = vi.fn(() => Promise.resolve(['too late']));
    const lease = Promise.withResolvers<undefined>();
    const { fanOut } = setUp(async (_practiceId, given) => {
      await lease.promise;
      return given(PRACTICE);
    });
    const answer = fanOut.read(ACCOUNT, ['a'], read);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await expect(answer).resolves.toEqual({
      items: [],
      unavailable: [{ practiceId: 'a', reason: 'TIMEOUT' }],
    });
    lease.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).not.toHaveBeenCalled();
  });

  it('still logs what fails after the time is up', async () => {
    vi.useFakeTimers();
    const failing = Promise.withResolvers<readonly string[]>();
    const { fanOut, logger } = setUp(() => failing.promise);
    const answer = fanOut.read(ACCOUNT, ['a'], reader);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await answer;
    failing.reject(new PracticeUnavailableError('a', 'PRACTICE_CONNECTION_FAILED'));
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.warn).toHaveBeenCalledWith(
      { practiceId: 'a', reasonCode: 'PRACTICE_CONNECTION_FAILED' },
      'practice left out of a fan-out',
    );
  });

  it('asks only the first practices, and names the rest as LIMIT', async () => {
    const practices = practicesCalled(21);
    const runInPractice = vi.fn(() => Promise.resolve([]));
    const { fanOut } = setUp(runInPractice);
    await expect(fanOut.read(ACCOUNT, practices, reader)).resolves.toEqual({
      items: [],
      unavailable: [{ practiceId: 'practice-20', reason: 'LIMIT' }],
    });
    expect(runInPractice).toHaveBeenCalledTimes(20);
  });

  it('runs at most the allowed number at a time', async () => {
    let running = 0;
    let most = 0;
    const { fanOut } = setUp(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setImmediate(resolve));
      running -= 1;
      return [];
    });
    await fanOut.read(ACCOUNT, practicesCalled(12), reader);
    expect(most).toBe(CONCURRENCY);
  });

  it('runs one at a time per account: a second is 429, and another account goes on', async () => {
    const answering = Promise.withResolvers<readonly string[]>();
    const { fanOut } = setUp(() => answering.promise);
    const first = fanOut.read(ACCOUNT, ['a'], reader);
    await expect(fanOut.read(ACCOUNT, ['a'], reader)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 1,
    });
    const other = fanOut.read('other', ['a'], reader);
    answering.resolve(['item']);
    await expect(first).resolves.toMatchObject({ items: ['item'] });
    await expect(other).resolves.toMatchObject({ items: ['item'] });
  });
});

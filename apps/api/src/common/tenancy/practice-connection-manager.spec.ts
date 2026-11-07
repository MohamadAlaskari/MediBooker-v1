import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakePinoLogger } from '../../../test/support/fake-pino-logger.js';
import {
  PRACTICE_A,
  PRACTICE_B,
  PRACTICE_C,
  PRACTICE_D,
  practiceRoute,
} from '../../../test/support/practice-routes.js';
import { TEST_ENV } from '../../../test/support/test-env.js';
import { parseEnv } from '../../config/env.schema.js';
import { FixedClock } from '../time/fixed-clock.js';
import type { PracticeClient, PracticeLease } from './practice-client.js';
import type { PracticeClientOpener } from './practice-client-opener.js';
import { PracticeConnectionManager } from './practice-connection-manager.js';
import { PracticeConnectionMetrics } from './practice-connection-metrics.js';
import { PracticeUnavailableError } from './practice-errors.js';
import type { PracticeRoute } from './practice-route.js';

const IDLE_MS = 60_000;

interface FakeClient {
  readonly practiceId: string;
  readonly $disconnect: ReturnType<typeof vi.fn>;
}

/** Opens fake clients; `hold()` keeps the next creation pending until the test resolves it. */
class FakeOpener {
  readonly clients: FakeClient[] = [];
  readonly open = vi.fn((route: PracticeRoute) => this.next(route));
  private pending: ((client: PracticeClient) => void) | undefined;

  private next(route: PracticeRoute): Promise<PracticeClient> {
    const client: FakeClient = {
      practiceId: route.id,
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };
    this.clients.push(client);
    const opened = client as unknown as PracticeClient;
    if (this.pending === undefined) return Promise.resolve(opened);
    return new Promise((resolve) => {
      this.pending = resolve;
    }).then(() => opened);
  }

  /** The next creation waits until `release()`. */
  hold(): { release: () => void } {
    this.pending = (): void => undefined;
    return {
      release: () => {
        const resolve = this.pending;
        this.pending = undefined;
        resolve?.({} as PracticeClient);
      },
    };
  }

  clientOf(practiceId: string, index = 0): FakeClient {
    const client = this.clients.filter((each) => each.practiceId === practiceId)[index];
    if (client === undefined) throw new Error(`no client of ${practiceId}`);
    return client;
  }
}

function setUp(variables: Record<string, string> = {}) {
  const env = parseEnv({ ...TEST_ENV, ...variables });
  const clock = new FixedClock(Temporal.Instant.from('2026-11-16T05:00:00Z'));
  const opener = new FakeOpener();
  const metrics = new PracticeConnectionMetrics();
  const { logger, calls } = fakePinoLogger();
  const manager = new PracticeConnectionManager(
    env,
    clock,
    opener as unknown as PracticeClientOpener,
    metrics,
    logger,
  );
  return { manager, clock, opener, metrics, calls };
}

/** The outcome of a promise without an unhandled rejection: the value, or the error. */
function settled(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    (value) => value,
    (error: unknown) => error,
  );
}

const A = practiceRoute(PRACTICE_A);
const B = practiceRoute(PRACTICE_B);
const C = practiceRoute(PRACTICE_C);
const D = practiceRoute(PRACTICE_D);

afterEach(() => {
  vi.useRealTimers();
});

describe('PracticeConnectionManager (02 §5, ADR 0005 §2.2)', () => {
  describe('the cache', () => {
    it('ADR-0005 §2.2 concurrent first acquisitions of one practice share one creation and one client', async () => {
      const { manager, opener, metrics } = setUp();
      const held = opener.hold();
      const first = manager.acquire(A, 'request');
      const second = manager.acquire(A, 'request');
      held.release();
      const [one, two] = await Promise.all([first, second]);
      expect(opener.open).toHaveBeenCalledTimes(1);
      expect(one.client).toBe(two.client);
      expect(one.practiceId).toBe(PRACTICE_A);
      expect(metrics.creations).toBe(1);
    });

    it('reuses the cached client; a new route version gets a client of its own', async () => {
      const { manager, opener } = setUp();
      const first = await manager.acquire(A, 'request');
      first.release();
      const again = await manager.acquire(A, 'job');
      expect(again.client).toBe(first.client);
      const rotated = await manager.acquire({ ...A, routeVersion: 2 }, 'request');
      expect(rotated.client).not.toBe(first.client);
      expect(opener.open).toHaveBeenCalledTimes(2);
    });

    it('shares a failed creation with every waiting acquisition, then tries again on the next one', async () => {
      const { manager, opener } = setUp();
      const failure = new PracticeUnavailableError(PRACTICE_A, 'PRACTICE_CONNECTION_FAILED');
      opener.open.mockRejectedValueOnce(failure);
      const outcomes = await Promise.all([
        settled(manager.acquire(A, 'request')),
        settled(manager.acquire(A, 'request')),
      ]);
      expect(outcomes).toEqual([failure, failure]);
      expect(manager.stats().openClients).toEqual({ request: 0, public: 0, job: 0, fanOut: 0 });
      await manager.acquire(A, 'request');
      expect(opener.open).toHaveBeenCalledTimes(2);
    });

    it('releases a lease once, also when release() is called twice', async () => {
      const { manager, opener } = setUp({ PRACTICE_CLIENTS_MAX: '1' });
      const first = await manager.acquire(A, 'request');
      const second = await manager.acquire(A, 'request');
      first.release();
      first.release();
      // A second release of `first` would make A idle while `second` still uses it, and B
      // would close it at once.
      const blocked = settled(manager.acquire(B, 'request'));
      await Promise.resolve();
      expect(opener.clientOf(PRACTICE_A).$disconnect).not.toHaveBeenCalled();
      expect(opener.open).toHaveBeenCalledTimes(1);
      second.release();
      expect(await blocked).toMatchObject({ practiceId: PRACTICE_B });
      expect(opener.clientOf(PRACTICE_A).$disconnect).toHaveBeenCalled();
    });
  });

  describe('LRU and in-flight leases (PRACTICE_CLIENTS_MAX)', () => {
    it('closes the least recently used idle client to open another', async () => {
      const { manager, opener, metrics } = setUp({ PRACTICE_CLIENTS_MAX: '2' });
      (await manager.acquire(A, 'request')).release();
      (await manager.acquire(B, 'request')).release();
      (await manager.acquire(A, 'request')).release();
      await manager.acquire(C, 'request');
      expect(opener.clientOf(PRACTICE_B).$disconnect).toHaveBeenCalled();
      expect(opener.clientOf(PRACTICE_A).$disconnect).not.toHaveBeenCalled();
      expect(metrics.evictions).toBe(1);
    });

    it('never closes a client with a request in flight: the next practice waits for a release', async () => {
      const { manager, opener, metrics } = setUp({ PRACTICE_CLIENTS_MAX: '2' });
      const leaseA = await manager.acquire(A, 'request');
      const leaseB = await manager.acquire(B, 'request');
      const waiting = manager.acquire(C, 'request');
      await Promise.resolve();
      expect(opener.open).toHaveBeenCalledTimes(2);
      leaseA.release();
      expect((await waiting).practiceId).toBe(PRACTICE_C);
      expect(opener.clientOf(PRACTICE_A).$disconnect).toHaveBeenCalled();
      expect(opener.clientOf(PRACTICE_B).$disconnect).not.toHaveBeenCalled();
      expect(metrics.waits).toBe(1);
      leaseB.release();
    });

    it('throws PRACTICE_CAPACITY_EXHAUSTED when nothing is released within 2 s', async () => {
      vi.useFakeTimers();
      const { manager, opener } = setUp({ PRACTICE_CLIENTS_MAX: '2' });
      await manager.acquire(A, 'request');
      await manager.acquire(B, 'request');
      const waiting = settled(manager.acquire(C, 'request'));
      await vi.advanceTimersByTimeAsync(1999);
      expect(opener.open).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(await waiting).toMatchObject({
        practiceId: PRACTICE_C,
        reason: 'PRACTICE_CAPACITY_EXHAUSTED',
      });
      expect(opener.clientOf(PRACTICE_A).$disconnect).not.toHaveBeenCalled();
    });
  });

  describe('purposes and budgets', () => {
    it('ADR-0005 §2.2 public and job acquisitions never close a client a signed-in request used within PRACTICE_CLIENT_IDLE_MS', async () => {
      vi.useFakeTimers();
      const { manager, opener, clock } = setUp({ PRACTICE_CLIENTS_MAX: '2' });
      (await manager.acquire(A, 'request')).release();
      (await manager.acquire(B, 'request')).release();
      const outcomes = [settled(manager.acquire(C, 'public')), settled(manager.acquire(D, 'job'))];
      await vi.advanceTimersByTimeAsync(2000);
      for (const outcome of await Promise.all(outcomes)) {
        expect(outcome).toMatchObject({ reason: 'PRACTICE_CAPACITY_EXHAUSTED' });
      }
      expect(opener.clientOf(PRACTICE_A).$disconnect).not.toHaveBeenCalled();
      expect(opener.clientOf(PRACTICE_B).$disconnect).not.toHaveBeenCalled();
      // Once no request has used A for PRACTICE_CLIENT_IDLE_MS, a public acquisition may close it.
      clock.advance({ milliseconds: IDLE_MS });
      await manager.acquire(C, 'public');
      expect(opener.clientOf(PRACTICE_A).$disconnect).toHaveBeenCalled();
    });

    it('public acquisitions hold at most PUBLIC_PRACTICE_CLIENTS_MAX clients: they close their own idle ones', async () => {
      const { manager, opener } = setUp({ PUBLIC_PRACTICE_CLIENTS_MAX: '1' });
      (await manager.acquire(A, 'request')).release();
      (await manager.acquire(B, 'public')).release();
      await manager.acquire(C, 'public');
      expect(opener.clientOf(PRACTICE_B).$disconnect).toHaveBeenCalled();
      expect(opener.clientOf(PRACTICE_A).$disconnect).not.toHaveBeenCalled();
      expect(manager.stats().openClients).toEqual({ request: 1, public: 1, job: 0, fanOut: 0 });
    });

    it('fan-outs hold at most FANOUT_PRACTICE_CLIENTS_MAX clients: they close their own idle ones', async () => {
      const { manager, opener } = setUp({ FANOUT_PRACTICE_CLIENTS_MAX: '1' });
      (await manager.acquire(A, 'request')).release();
      (await manager.acquire(B, 'fanOut')).release();
      await manager.acquire(C, 'fanOut');
      expect(opener.clientOf(PRACTICE_B).$disconnect).toHaveBeenCalled();
      expect(opener.clientOf(PRACTICE_A).$disconnect).not.toHaveBeenCalled();
      expect(manager.stats().openClients).toEqual({ request: 1, public: 0, job: 0, fanOut: 1 });
    });

    it('a fan-out never closes a client a signed-in request used recently, also at the overall limit', async () => {
      vi.useFakeTimers();
      const { manager, opener } = setUp({ PRACTICE_CLIENTS_MAX: '1' });
      (await manager.acquire(A, 'request')).release();
      const waiting = settled(manager.acquire(B, 'fanOut'));
      await vi.advanceTimersByTimeAsync(2000);
      expect(await waiting).toMatchObject({ reason: 'PRACTICE_CAPACITY_EXHAUSTED' });
      expect(opener.clientOf(PRACTICE_A).$disconnect).not.toHaveBeenCalled();
    });

    it('jobs hold at most JOB_PRACTICE_CLIENTS_MAX clients at once', async () => {
      vi.useFakeTimers();
      const { manager, opener } = setUp({ JOB_PRACTICE_CLIENTS_MAX: '1' });
      const held = await manager.acquire(A, 'job');
      const waiting = settled(manager.acquire(B, 'job'));
      await vi.advanceTimersByTimeAsync(2000);
      expect(await waiting).toMatchObject({ reason: 'PRACTICE_CAPACITY_EXHAUSTED' });
      expect(manager.stats().openClients.job).toBe(1);
      held.release();
      await manager.acquire(B, 'job');
      expect(opener.clientOf(PRACTICE_A).$disconnect).toHaveBeenCalled();
    });

    it('counts a client a signed-in request used recently as a request client, whoever used it last', async () => {
      const { manager } = setUp();
      (await manager.acquire(A, 'request')).release();
      (await manager.acquire(A, 'public')).release();
      expect(manager.stats().openClients).toEqual({ request: 1, public: 0, job: 0, fanOut: 0 });
    });
  });

  describe('the creation rate (PRACTICE_CLIENT_CREATIONS_PER_SECOND)', () => {
    it('fails a public acquisition at once above the rate; a signed-in request waits for the window', async () => {
      vi.useFakeTimers();
      const { manager, clock, opener } = setUp({ PRACTICE_CLIENT_CREATIONS_PER_SECOND: '1' });
      await manager.acquire(A, 'request');
      expect(await settled(manager.acquire(B, 'public'))).toMatchObject({
        reason: 'PRACTICE_CREATION_RATE_EXCEEDED',
      });
      const waiting = manager.acquire(C, 'request');
      await vi.advanceTimersByTimeAsync(500);
      expect(opener.open).toHaveBeenCalledTimes(1);
      clock.advance({ milliseconds: 1000 });
      await vi.advanceTimersByTimeAsync(500);
      expect((await waiting).practiceId).toBe(PRACTICE_C);
    });

    it('fails a fan-out at once above the rate, and does not count a use of it as a signed-in one', async () => {
      const { manager, clock } = setUp({ PRACTICE_CLIENT_CREATIONS_PER_SECOND: '1' });
      (await manager.acquire(A, 'fanOut')).release();
      expect(await settled(manager.acquire(B, 'fanOut'))).toMatchObject({
        reason: 'PRACTICE_CREATION_RATE_EXCEEDED',
      });
      expect(manager.stats().openClients.fanOut).toBe(1);
      clock.advance({ milliseconds: 1000 });
      (await manager.acquire(B, 'fanOut')).release();
      expect(manager.stats().openClients).toEqual({ request: 0, public: 0, job: 0, fanOut: 2 });
    });
  });

  describe('evictIdle (02 §5 item 6)', () => {
    it('closes a client idle for PRACTICE_CLIENT_IDLE_MS after the FixedClock is stepped, not before', async () => {
      const { manager, clock, opener, metrics } = setUp();
      (await manager.acquire(A, 'request')).release();
      clock.advance({ milliseconds: IDLE_MS - 1 });
      await manager.evictIdle();
      expect(opener.clientOf(PRACTICE_A).$disconnect).not.toHaveBeenCalled();
      clock.advance({ milliseconds: 1 });
      await manager.evictIdle();
      expect(opener.clientOf(PRACTICE_A).$disconnect).toHaveBeenCalled();
      expect(metrics.evictions).toBe(1);
      await manager.acquire(A, 'request');
      expect(opener.open).toHaveBeenCalledTimes(2);
    });

    it('never closes a client in flight, however long it is held', async () => {
      const { manager, clock, opener } = setUp();
      const lease = await manager.acquire(A, 'job');
      clock.advance({ milliseconds: IDLE_MS * 10 });
      await manager.evictIdle();
      expect(opener.clientOf(PRACTICE_A).$disconnect).not.toHaveBeenCalled();
      lease.release();
    });

    it('closes the client of an older route version once it is released', async () => {
      const { manager, opener } = setUp();
      const old = await manager.acquire(A, 'request');
      const current = await manager.acquire({ ...A, routeVersion: 2 }, 'request');
      await manager.evictIdle();
      expect(opener.clientOf(PRACTICE_A, 0).$disconnect).not.toHaveBeenCalled();
      old.release();
      current.release();
      await manager.evictIdle();
      expect(opener.clientOf(PRACTICE_A, 0).$disconnect).toHaveBeenCalled();
      expect(opener.clientOf(PRACTICE_A, 1).$disconnect).not.toHaveBeenCalled();
    });

    it('runs every quarter of PRACTICE_CLIENT_IDLE_MS from init until destroy, which closes every client', async () => {
      vi.useFakeTimers();
      const { manager, clock, opener } = setUp();
      manager.onModuleInit();
      (await manager.acquire(A, 'request')).release();
      await manager.acquire(B, 'request');
      clock.advance({ milliseconds: IDLE_MS });
      await vi.advanceTimersByTimeAsync(IDLE_MS / 4);
      expect(opener.clientOf(PRACTICE_A).$disconnect).toHaveBeenCalled();
      expect(opener.clientOf(PRACTICE_B).$disconnect).not.toHaveBeenCalled();
      await manager.onModuleDestroy();
      expect(opener.clientOf(PRACTICE_B).$disconnect).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('logs a client that fails to close by the practice id, and goes on', async () => {
      const { manager, clock, opener, calls } = setUp();
      (await manager.acquire(A, 'request')).release();
      opener.clientOf(PRACTICE_A).$disconnect.mockRejectedValueOnce(new Error('already closed'));
      clock.advance({ milliseconds: IDLE_MS });
      await manager.evictIdle();
      expect(calls).toEqual([
        expect.objectContaining({
          level: 'warn',
          fields: expect.objectContaining({ practiceId: PRACTICE_A }) as unknown,
          message: 'practice client close failed',
        }),
      ]);
    });
  });

  describe('close (02 §5 item 7)', () => {
    it('takes a failed client out at once and closes it after its last release', async () => {
      const { manager, opener } = setUp();
      const failed = await manager.acquire(A, 'request');
      const other = await manager.acquire(A, 'request');
      manager.close(failed);
      manager.close(failed);
      const fresh = await manager.acquire(A, 'request');
      expect(fresh.client).not.toBe(failed.client);
      failed.release();
      expect(opener.clientOf(PRACTICE_A, 0).$disconnect).not.toHaveBeenCalled();
      other.release();
      expect(opener.clientOf(PRACTICE_A, 0).$disconnect).toHaveBeenCalledTimes(1);
      fresh.release();
    });

    it('ignores a lease it did not hand out', () => {
      const { manager } = setUp();
      expect(() => {
        manager.close({ practiceId: PRACTICE_A } as PracticeLease);
      }).not.toThrow();
    });
  });

  it('reports open clients per purpose and its counters', async () => {
    const { manager, metrics } = setUp();
    await manager.acquire(A, 'request');
    await manager.acquire(B, 'public');
    await manager.acquire(C, 'job');
    metrics.authenticationFailures = 2;
    expect(manager.stats()).toEqual({
      openClients: { request: 1, public: 1, job: 1, fanOut: 0 },
      creations: 3,
      evictions: 0,
      waits: 0,
      authenticationFailures: 2,
      identityMismatches: 0,
      openAcls: 0,
    });
  });
});

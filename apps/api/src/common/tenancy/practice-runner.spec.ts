import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import { fakePinoLogger } from '../../../test/support/fake-pino-logger.js';
import {
  PRACTICE_A,
  PRACTICE_B,
  PRACTICE_C,
  practiceRoute,
} from '../../../test/support/practice-routes.js';
import type { RequestContext } from '../context/request-context.js';
import type { PracticeClient, PracticeLease } from './practice-client.js';
import type { PracticeConnectionManager } from './practice-connection-manager.js';
import { PracticeUnavailableError } from './practice-errors.js';
import type { PracticeResolution, PracticeResolver } from './practice-resolver.js';
import type { ResolvedPractice } from './practice-route.js';
import { PracticeRunner } from './practice-runner.js';

const cls = ClsServiceManager.getClsService<RequestContext>();

function setUp(
  resolutionOf: (practiceId: string) => PracticeResolution = (id) => ({
    answer: 'SERVE',
    route: practiceRoute(id),
  }),
) {
  const leases: (PracticeLease & { release: ReturnType<typeof vi.fn> })[] = [];
  const purposes: string[] = [];
  const resolver = {
    resolve: vi.fn((practiceId: string) => Promise.resolve(resolutionOf(practiceId))),
    activePracticeIds: vi.fn().mockResolvedValue([PRACTICE_A, PRACTICE_B, PRACTICE_C]),
  };
  const connections = {
    acquire: vi.fn((route: { id: string }, purpose: string) => {
      const lease = { practiceId: route.id, client: {} as PracticeClient, release: vi.fn() };
      purposes.push(purpose);
      leases.push(lease);
      return Promise.resolve(lease);
    }),
    close: vi.fn(),
  };
  const { logger, calls } = fakePinoLogger();
  const runner = new PracticeRunner(
    resolver as unknown as PracticeResolver,
    connections as unknown as PracticeConnectionManager,
    cls,
    logger,
  );
  return { runner, resolver, connections, leases, purposes, calls };
}

describe('runInPractice (02 §5, ADR 0005 §2.5)', () => {
  it('runs fn in a fresh request context with the practice resolved and its client leased for the purpose', async () => {
    const { runner, resolver, connections, leases } = setUp();
    const seen = await cls.run(async () => {
      cls.set('practice', {
        practice: { id: PRACTICE_B } as ResolvedPractice,
        lease: {} as PracticeLease,
      });
      const inside = await runner.runInPractice(
        PRACTICE_A,
        (practice) => Promise.resolve({ practice, context: cls.get('practice') }),
        { purpose: 'job' },
      );
      return { inside, outside: cls.get('practice')?.practice.id };
    });
    expect(resolver.resolve).toHaveBeenCalledWith(PRACTICE_A, 'job');
    expect(connections.acquire).toHaveBeenCalledWith(practiceRoute(PRACTICE_A), 'job');
    expect(seen.inside.practice).toMatchObject({ id: PRACTICE_A, routeVersion: 1 });
    expect(seen.inside.context).toEqual({ practice: seen.inside.practice, lease: leases[0] });
    // The caller's context is untouched.
    expect(seen.outside).toBe(PRACTICE_B);
    expect(leases[0]?.release).toHaveBeenCalledTimes(1);
  });

  it('also works without a surrounding context, as a job starts it', async () => {
    const { runner } = setUp();
    expect(
      await runner.runInPractice(PRACTICE_A, (practice) => Promise.resolve(practice.id), {
        purpose: 'job',
      }),
    ).toBe(PRACTICE_A);
  });

  it.each<[string, PracticeResolution, string]>([
    ['an unknown or hidden practice', { answer: 'NOT_FOUND' }, 'PRACTICE_NOT_FOUND'],
    [
      'a practice the status table pauses',
      { answer: 'UNAVAILABLE', reason: 'PRACTICE_STATUS_UNAVAILABLE' },
      'PRACTICE_STATUS_UNAVAILABLE',
    ],
    [
      'a practice behind the schema',
      { answer: 'UNAVAILABLE', reason: 'PRACTICE_SCHEMA_BEHIND' },
      'PRACTICE_SCHEMA_BEHIND',
    ],
  ])(
    'throws PracticeUnavailableError for %s, before any lease',
    async (_case, resolution, reason) => {
      const { runner, connections } = setUp(() => resolution);
      const fn = vi.fn();
      await expect(
        runner.runInPractice(PRACTICE_A, fn, { purpose: 'request' }),
      ).rejects.toMatchObject({
        practiceId: PRACTICE_A,
        reason,
      });
      expect(fn).not.toHaveBeenCalled();
      expect(connections.acquire).not.toHaveBeenCalled();
    },
  );

  it('refuses an id that is not a UUID without reading the registry', async () => {
    const { runner, resolver } = setUp();
    await expect(
      runner.runInPractice('secret-value', vi.fn(), { purpose: 'job' }),
    ).rejects.toMatchObject({
      reason: 'PRACTICE_NOT_FOUND',
    });
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('releases the lease when fn fails and passes the error on', async () => {
    const { runner, leases, connections } = setUp();
    const failure = new Error('job failed');
    await expect(
      runner.runInPractice(PRACTICE_A, () => Promise.reject(failure), { purpose: 'job' }),
    ).rejects.toBe(failure);
    expect(leases[0]?.release).toHaveBeenCalledTimes(1);
    expect(connections.close).not.toHaveBeenCalled();
  });

  it('closes the client and throws PRACTICE_CONNECTION_FAILED when the connection fails in fn', async () => {
    const { runner, leases, connections } = setUp();
    const refused = new PrismaClientKnownRequestError('refused', {
      code: 'P2010',
      clientVersion: '7.10.1',
      meta: { driverAdapterError: { cause: { kind: 'DatabaseNotReachable' } } },
    });
    await expect(
      runner.runInPractice(PRACTICE_A, () => Promise.reject(refused), { purpose: 'job' }),
    ).rejects.toMatchObject({ reason: 'PRACTICE_CONNECTION_FAILED', cause: refused });
    expect(connections.close).toHaveBeenCalledWith(leases[0]);
    expect(leases[0]?.release).toHaveBeenCalledTimes(1);
  });
});

describe('forEachPractice (02 §5)', () => {
  it('runs every ACTIVE practice with purpose job; a failing one is logged and counted, the others continue', async () => {
    const { runner, purposes, calls } = setUp((id) =>
      id === PRACTICE_C
        ? { answer: 'UNAVAILABLE', reason: 'PRACTICE_SCHEMA_BEHIND' }
        : { answer: 'SERVE', route: practiceRoute(id) },
    );
    const visited: string[] = [];
    const summary = await runner.forEachPractice(
      (practice) => {
        visited.push(practice.id);
        return practice.id === PRACTICE_B
          ? Promise.reject(new Error('job failed'))
          : Promise.resolve();
      },
      { concurrency: 2 },
    );
    expect(summary).toEqual({ succeeded: 1, failed: 2 });
    expect(visited.sort()).toEqual([PRACTICE_A, PRACTICE_B]);
    expect(purposes).toEqual(['job', 'job']);
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          level: 'error',
          fields: expect.objectContaining({ practiceId: PRACTICE_B }) as unknown,
          message: 'practice job failed',
        },
        {
          level: 'warn',
          fields: { practiceId: PRACTICE_C, reasonCode: 'PRACTICE_SCHEMA_BEHIND' },
          message: 'practice job skipped',
        },
      ]),
    );
  });

  it('runs at most `concurrency` practices at once, each in its own context', async () => {
    const { runner } = setUp();
    let running = 0;
    let mostAtOnce = 0;
    const contexts: (string | undefined)[] = [];
    await runner.forEachPractice(
      async (practice) => {
        running += 1;
        mostAtOnce = Math.max(mostAtOnce, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        contexts.push(cls.get('practice')?.practice.id === practice.id ? practice.id : undefined);
        running -= 1;
      },
      { concurrency: 2 },
    );
    expect(mostAtOnce).toBe(2);
    expect(contexts.sort()).toEqual([PRACTICE_A, PRACTICE_B, PRACTICE_C]);
  });

  it('does nothing without ACTIVE practices', async () => {
    const { runner, resolver } = setUp();
    resolver.activePracticeIds.mockResolvedValueOnce([]);
    expect(await runner.forEachPractice(vi.fn(), { concurrency: 4 })).toEqual({
      succeeded: 0,
      failed: 0,
    });
  });
});

describe('PracticeUnavailableError', () => {
  it('carries a constant message, never the practice or the reason as text', () => {
    const error = new PracticeUnavailableError(PRACTICE_A, 'PRACTICE_ACL_OPEN');
    expect(error.message).toBe('practice unavailable');
  });
});

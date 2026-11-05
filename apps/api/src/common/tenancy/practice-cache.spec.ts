import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import { PRACTICE_A, PRACTICE_B } from '../../../test/support/practice-routes.js';
import type { RequestContext } from '../context/request-context.js';
import { FixedClock } from '../time/fixed-clock.js';
import type { PracticeLease } from './practice-client.js';
import { PracticeCache } from './practice-cache.js';
import { PracticeContextMissingError } from './practice-errors.js';
import type { ResolvedPractice } from './practice-route.js';

const cls = ClsServiceManager.getClsService<RequestContext>();

function practice(id: string, routeVersion = 1): ResolvedPractice {
  return { id, market: 'SA', routeVersion, schemaVersion: '20261105140000_practice_identity' };
}

/** Runs `fn` with a resolved practice in a request context. */
function inPractice<T>(resolved: ResolvedPractice, fn: () => Promise<T>): Promise<T> {
  return cls.run(() => {
    cls.set('practice', { practice: resolved, lease: {} as PracticeLease });
    return fn();
  });
}

function setUp(): { cache: PracticeCache; clock: FixedClock } {
  const clock = new FixedClock(Temporal.Instant.from('2026-11-16T05:00:00Z'));
  return { cache: new PracticeCache(cls, clock), clock };
}

describe('PracticeCache (ADR 0005 §10)', () => {
  it('refuses to work without a resolved practice', async () => {
    const { cache } = setUp();
    await expect(
      cache.getOrLoad('settings', 1000, () => Promise.resolve(1)),
    ).rejects.toBeInstanceOf(PracticeContextMissingError);
    await expect(
      cls.run(() => cache.getOrLoad('settings', 1000, () => Promise.resolve(1))),
    ).rejects.toBeInstanceOf(PracticeContextMissingError);
  });

  it('builds every key from the practice id and the route version', async () => {
    const { cache } = setUp();
    expect(
      await inPractice(practice(PRACTICE_A), () => Promise.resolve(cache.keyOf('settings'))),
    ).toBe(`${PRACTICE_A}:1:settings`);
    expect(
      await inPractice(practice(PRACTICE_A, 2), () => Promise.resolve(cache.keyOf('settings'))),
    ).toBe(`${PRACTICE_A}:2:settings`);
  });

  it('ADR-0005 §11.12 gives concurrent reads of A and B their own values', async () => {
    const { cache } = setUp();
    const load = (value: string) => () =>
      new Promise<string>((resolve) => setTimeout(resolve, 5, value));
    const values = await Promise.all([
      inPractice(practice(PRACTICE_A), () => cache.getOrLoad('settings', 60_000, load('A'))),
      inPractice(practice(PRACTICE_B), () => cache.getOrLoad('settings', 60_000, load('B'))),
    ]);
    expect(values).toEqual(['A', 'B']);
    expect(
      await inPractice(practice(PRACTICE_A), () => cache.getOrLoad('settings', 60_000, load('X'))),
    ).toBe('A');
    expect(
      await inPractice(practice(PRACTICE_B), () => cache.getOrLoad('settings', 60_000, load('X'))),
    ).toBe('B');
  });

  it('loads again after the time to live, read from the Clock', async () => {
    const { cache, clock } = setUp();
    const load = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    const read = (): Promise<unknown> =>
      inPractice(practice(PRACTICE_A), () => cache.getOrLoad('page', 10_000, load));
    expect(await read()).toBe('first');
    clock.advance({ milliseconds: 9999 });
    expect(await read()).toBe('first');
    clock.advance({ milliseconds: 1 });
    expect(await read()).toBe('second');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('starts empty for a new route version after a restore or move', async () => {
    const { cache } = setUp();
    await inPractice(practice(PRACTICE_A), () =>
      cache.getOrLoad('page', 60_000, () => Promise.resolve('old')),
    );
    expect(
      await inPractice(practice(PRACTICE_A, 2), () =>
        cache.getOrLoad('page', 60_000, () => Promise.resolve('new')),
      ),
    ).toBe('new');
  });
});

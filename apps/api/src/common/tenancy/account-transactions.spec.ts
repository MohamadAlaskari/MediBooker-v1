import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.schema.js';
import type { RequestContext } from '../context/request-context.js';
import { AccountTransactions } from './account-transactions.js';
import type { PracticeTransactionHost } from './practice-transactional.adapter.js';

const cls = ClsServiceManager.getClsService<RequestContext>();
const USER = 'user-a';

function setUp(poolMax = 3) {
  const executeRaw = vi.fn().mockResolvedValue(1);
  const txHost = {
    tx: { $executeRaw: executeRaw },
    withTransaction: <T>(work: () => Promise<T>): Promise<T> => work(),
  } as unknown as PracticeTransactionHost;
  const env = { PRACTICE_POOL_MAX: poolMax, DATABASE_LOCK_TIMEOUT_MS: 2000 } as Env;
  const transactions = new AccountTransactions(env, txHost, cls);
  const inPractice = <T>(practiceId: string, work: () => Promise<T>) =>
    cls.run(() => {
      cls.set('practice', {
        practice: { id: practiceId, market: 'SA', routeVersion: 1, schemaVersion: 'v' },
        lease: {} as never,
      });
      return work();
    });
  /** Work that stays under way until `finish` is called. */
  const pending = () => {
    const { promise, resolve } = Promise.withResolvers<string>();
    return {
      work: () => promise,
      finish: () => {
        resolve('done');
      },
    };
  };
  return { transactions, inPractice, pending, executeRaw };
}

describe('AccountTransactions', () => {
  it('limits the wait for a lock inside the transaction, before the work', async () => {
    const { transactions, inPractice, executeRaw } = setUp();
    const order: string[] = [];
    executeRaw.mockImplementation(() => {
      order.push('limit');
      return Promise.resolve(1);
    });
    await inPractice('practice-a', () =>
      transactions.run(USER, () => {
        order.push('work');
        return Promise.resolve();
      }),
    );
    expect(order).toEqual(['limit', 'work']);
    expect(executeRaw.mock.calls[0]?.slice(1)).toEqual(['2000ms']);
  });

  it('leaves one connection to others: the pool minus one at a time, then 429 with a time', async () => {
    const { transactions, inPractice, pending } = setUp(3);
    const [first, second] = [pending(), pending()];
    await inPractice('practice-a', async () => {
      const running = [transactions.run(USER, first.work), transactions.run(USER, second.work)];
      await expect(transactions.run(USER, () => Promise.resolve('third'))).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        retryAfterSeconds: 1,
      });
      first.finish();
      second.finish();
      await expect(Promise.all(running)).resolves.toEqual(['done', 'done']);
    });
  });

  it('lets one run at a time with a pool of one', async () => {
    const { transactions, inPractice, pending } = setUp(1);
    const first = pending();
    await inPractice('practice-a', async () => {
      const running = transactions.run(USER, first.work);
      await expect(transactions.run(USER, () => Promise.resolve('second'))).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
      first.finish();
      await running;
    });
  });

  it('counts per account and per practice: each practice has its own connections', async () => {
    const { transactions, inPractice, pending } = setUp(2);
    const first = pending();
    const running = inPractice('practice-a', () => transactions.run(USER, first.work));
    await expect(
      inPractice('practice-a', () => transactions.run('user-b', () => Promise.resolve('other'))),
    ).resolves.toBe('other');
    await expect(
      inPractice('practice-b', () => transactions.run(USER, () => Promise.resolve('elsewhere'))),
    ).resolves.toBe('elsewhere');
    first.finish();
    await running;
  });

  it('frees the place after a failure, too', async () => {
    const { transactions, inPractice } = setUp(2);
    await inPractice('practice-a', async () => {
      await expect(transactions.run(USER, () => Promise.reject(new Error('x')))).rejects.toThrow(
        'x',
      );
      await expect(transactions.run(USER, () => Promise.resolve('next'))).resolves.toBe('next');
    });
  });
});

import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import { PRACTICE_A } from '../../../test/support/practice-routes.js';
import { TEST_ENV } from '../../../test/support/test-env.js';
import { parseEnv } from '../../config/env.schema.js';
import type { RequestContext } from '../context/request-context.js';
import type { PracticeClient } from './practice-client.js';
import { PracticeContextMissingError } from './practice-errors.js';
import type { ResolvedPractice } from './practice-route.js';
import {
  PracticeTransactionalAdapter,
  practiceTransactionalPlugin,
} from './practice-transactional.adapter.js';

const cls = ClsServiceManager.getClsService<RequestContext>();
const LIMITS = { maxWait: 2000, timeout: 5000 };

function fakeClient() {
  const tx = { practiceIdentity: {} };
  const $transaction = vi.fn((fn: (client: typeof tx) => Promise<unknown>): Promise<unknown> =>
    fn(tx),
  );
  return { client: { $transaction } as unknown as PracticeClient, $transaction, tx };
}

function withPractice<T>(client: PracticeClient, fn: () => T): T {
  return cls.run(() => {
    cls.set('practice', {
      practice: { id: PRACTICE_A } as ResolvedPractice,
      lease: { practiceId: PRACTICE_A, client, release: vi.fn() },
    });
    return fn();
  });
}

describe('PracticeTransactionalAdapter (02 §5)', () => {
  const adapter = new PracticeTransactionalAdapter(LIMITS);
  const options = adapter.optionsFactory(adapter.connection);

  it("gives the leased client of the request context's practice as the plain instance", () => {
    const { client } = fakeClient();
    expect(withPractice(client, () => options.getFallbackInstance())).toBe(client);
  });

  it('runs a transaction on that client with DATABASE_TX_MAX_WAIT_MS and DATABASE_TX_TIMEOUT_MS', async () => {
    const { client, $transaction, tx } = fakeClient();
    const setTx = vi.fn();
    const result = await withPractice(client, () =>
      options.wrapWithTransaction({}, () => Promise.resolve('done'), setTx),
    );
    expect(result).toBe('done');
    expect(setTx).toHaveBeenCalledWith(tx);
    expect($transaction).toHaveBeenCalledWith(expect.any(Function), LIMITS);
  });

  it('lets a transaction narrow the limits and set an isolation level', async () => {
    const { client, $transaction } = fakeClient();
    await withPractice(client, () =>
      options.wrapWithTransaction(
        { timeout: 1000, isolationLevel: 'Serializable' },
        () => Promise.resolve(),
        vi.fn(),
      ),
    );
    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 2000,
      timeout: 1000,
      isolationLevel: 'Serializable',
    });
  });

  it('ADR-0005 §11.9 throws PracticeContextMissingError without a resolved practice', () => {
    expect(() => options.getFallbackInstance()).toThrow(PracticeContextMissingError);
    expect(() => cls.run(() => options.getFallbackInstance())).toThrow(PracticeContextMissingError);
    expect(() => options.wrapWithTransaction({}, () => Promise.resolve(), vi.fn())).toThrow(
      PracticeContextMissingError,
    );
  });

  it('is registered as the plugin of the practice connection', () => {
    expect(practiceTransactionalPlugin(parseEnv(TEST_ENV)).name).toBe(
      'cls-plugin-transactional-practice',
    );
  });
});

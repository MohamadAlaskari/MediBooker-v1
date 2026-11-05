import {
  ClsPluginTransactional,
  type TransactionalAdapter,
  type TransactionHost,
} from '@nestjs-cls/transactional';
import { type ClsService, ClsServiceManager } from 'nestjs-cls';
import type { Env } from '../../config/env.schema.js';
import type { Prisma } from '../../generated/practice/client.js';
import type { RequestContext } from '../context/request-context.js';
import type { PracticeClient } from './practice-client.js';
import { requirePracticeContext } from './practice-context.js';

type PracticeTransactionClient = Prisma.TransactionClient;

interface PracticeTransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * The transactional adapter of the `practice` connection (02 §5): it reaches the client of the
 * practice in the request context, which the PracticeContextInterceptor or `runInPractice` leased.
 * Without a resolved practice both the plain client and a transaction throw
 * PracticeContextMissingError. Transactions wait at most DATABASE_TX_MAX_WAIT_MS for a connection
 * and run at most DATABASE_TX_TIMEOUT_MS.
 */
export class PracticeTransactionalAdapter implements TransactionalAdapter<
  ClsService<RequestContext>,
  PracticeTransactionClient,
  PracticeTransactionOptions
> {
  readonly connection = ClsServiceManager.getClsService<RequestContext>();

  constructor(private readonly limits: { readonly maxWait: number; readonly timeout: number }) {}

  readonly optionsFactory = (cls: ClsService<RequestContext>) => ({
    wrapWithTransaction: (
      options: PracticeTransactionOptions,
      fn: () => Promise<unknown>,
      setTx: (tx?: PracticeTransactionClient) => void,
    ): Promise<unknown> =>
      clientOf(cls).$transaction(
        async (tx) => {
          setTx(tx);
          return fn();
        },
        { ...this.limits, ...options },
      ),
    getFallbackInstance: (): PracticeTransactionClient => clientOf(cls),
  });
}

function clientOf(cls: ClsService<RequestContext>): PracticeClient {
  return requirePracticeContext(cls).lease.client;
}

/** The `practice` transaction host: `@InjectTransactionHost('practice') txHost: PracticeTransactionHost`. */
export type PracticeTransactionHost = TransactionHost<PracticeTransactionalAdapter>;

export function practiceTransactionalPlugin(env: Env): ClsPluginTransactional {
  return new ClsPluginTransactional({
    connectionName: 'practice',
    adapter: new PracticeTransactionalAdapter({
      maxWait: env.DATABASE_TX_MAX_WAIT_MS,
      timeout: env.DATABASE_TX_TIMEOUT_MS,
    }),
  });
}

import { ClsPluginTransactional, type TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { PlatformDatabaseModule } from './platform-database.module.js';
import { PlatformPrismaService } from './platform-prisma.service.js';

/** The `platform` transaction host: `@InjectTransactionHost('platform') txHost: PlatformTransactionHost`. */
export type PlatformTransactionHost = TransactionHost<
  TransactionalAdapterPrisma<PlatformPrismaService>
>;

/**
 * The transactional plugin of the platform database (02 §5): `@Transactional('platform')` and
 * `txHost.withTransaction()` run on PlatformPrismaService, whose client options carry
 * DATABASE_TX_MAX_WAIT_MS and DATABASE_TX_TIMEOUT_MS.
 */
export function platformTransactionalPlugin(): ClsPluginTransactional {
  return new ClsPluginTransactional({
    connectionName: 'platform',
    imports: [PlatformDatabaseModule],
    adapter: new TransactionalAdapterPrisma<PlatformPrismaService>({
      prismaInjectionToken: PlatformPrismaService,
    }),
  });
}

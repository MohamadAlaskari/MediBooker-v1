import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PinoLogger } from 'nestjs-pino';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { type Prisma, PrismaClient } from '../../generated/platform/client.js';
import { PRISMA_LOG_EVENTS } from './prisma-log-events.js';

type PlatformClientOptions = Prisma.PrismaClientOptions & { log: typeof PRISMA_LOG_EVENTS };

/**
 * The platform database as `platform_app` (02 §5): accounts, the practice registry and the
 * coordination tables. Modules reach it through the `platform` transaction host; only `common/`
 * and `health/` use it directly. Outside local and ci the URL carries `sslmode=verify-full` and
 * `sslrootcert`, which parseEnv enforces.
 *
 * It does no I/O when it is built or initialised: the pool connects on the first query, and
 * main.ts checks the database after `listen`, once the process handlers log through pino.
 */
@Injectable()
export class PlatformPrismaService
  extends PrismaClient<PlatformClientOptions>
  implements OnModuleDestroy
{
  constructor(
    @Inject(ENV) env: Env,
    private readonly logger: PinoLogger,
  ) {
    super({
      adapter: new PrismaPg({
        connectionString: env.PLATFORM_DATABASE_URL,
        max: env.PLATFORM_DATABASE_POOL_MAX,
      }),
      errorFormat: 'minimal',
      log: PRISMA_LOG_EVENTS,
      transactionOptions: {
        maxWait: env.DATABASE_TX_MAX_WAIT_MS,
        timeout: env.DATABASE_TX_TIMEOUT_MS,
      },
    });
    logger.setContext(PlatformPrismaService.name);
    this.$on('warn', () => {
      this.logger.warn('platform database warning');
    });
    this.$on('error', () => {
      this.logger.error('platform database error');
    });
  }

  /** One round trip: rejects when the platform database cannot be reached. */
  async assertReachable(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  /**
   * The newest finished, not rolled-back platform migration (readiness, 02 §10), or undefined
   * before the first one. Migration names start with their timestamp, so they sort in order.
   */
  async schemaVersion(): Promise<string | undefined> {
    const rows = await this.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name DESC
      LIMIT 1`;
    return rows[0]?.migration_name;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

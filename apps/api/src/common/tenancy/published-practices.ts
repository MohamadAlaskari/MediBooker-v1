import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { PlatformPrismaService } from '../database/platform-prisma.service.js';
import { servedMarkets } from './practice-access.rules.js';

/**
 * The practices the public can reach, from the registry alone (the sitemap). Apart from
 * PracticeResolver, so that a feature can list them without getting hold of a practice's route and
 * its secret references.
 */
@Injectable()
export class PublishedPractices {
  private readonly markets: readonly string[] | undefined;

  constructor(
    private readonly platform: PlatformPrismaService,
    @Inject(ENV) env: Env,
  ) {
    this.markets = servedMarkets({ appEnv: env.APP_ENV, markets: env.MARKETS });
  }

  /**
   * Current slugs in slug order, behind `after`. A suspended or moving practice answers 503 for now
   * and is not listed meanwhile.
   */
  async slugs(after: string | undefined, take: number): Promise<string[]> {
    const rows = await this.platform.practiceSlug.findMany({
      where: {
        retiredAt: null,
        ...(after === undefined ? {} : { slug: { gt: after } }),
        practice: {
          status: 'ACTIVE',
          publishedAt: { not: null },
          ...(this.markets === undefined ? {} : { market: { in: [...this.markets] } }),
        },
      },
      orderBy: { slug: 'asc' },
      take,
      select: { slug: true },
    });
    return rows.map(({ slug }) => slug);
  }
}

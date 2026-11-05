import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Controller, Get, Module, NotFoundException, Param } from '@nestjs/common';
import type { PlatformTransactionHost } from '../../../src/common/database/platform-transactional.js';
import { Public } from '../../../src/common/security/public.decorator.js';
import { SYNTHETIC_EMAIL, SYNTHETIC_SECRET_VALUE } from '../../support/probe.module.js';

/** A fixed instant for the retired slug: tests never read the system clock (06 §3). */
const RETIRED_AT = new Date('2026-11-16T05:00:00Z');

/** A practice of the registry, so a slug passes its foreign key. */
async function anyPracticeId(platform: PlatformTransactionHost): Promise<string> {
  const practice = await platform.tx.practice.findFirstOrThrow({ select: { id: true } });
  return practice.id;
}

/**
 * Platform queries that fail with a synthetic marker of 02 §8 in their input, as feature code
 * would run them through the `platform` transaction host. logging.int-spec.ts proves both that
 * the errors carry the markers and that no log keeps them.
 */
export const FORCED_PLATFORM_ERRORS = {
  /** A PrismaClientValidationError, raised before any query is sent: Prisma names the argument. */
  validation: (platform: PlatformTransactionHost) =>
    platform.tx.practiceSlug.findMany({
      where: { [SYNTHETIC_EMAIL]: SYNTHETIC_SECRET_VALUE } as never,
    }),
  /** The slug CHECK rejects the value in the database (23514). */
  'check-violation': async (platform: PlatformTransactionHost) =>
    platform.tx.practiceSlug.create({
      data: { slug: SYNTHETIC_EMAIL, practiceId: await anyPracticeId(platform) },
    }),
  /** The same slug twice violates the primary key (23505); the transaction rolls back. */
  'unique-violation': async (platform: PlatformTransactionHost) => {
    const practiceId = await anyPracticeId(platform);
    await platform.withTransaction(async () => {
      // Retired first, so only the primary key and not the one-current-slug index is violated.
      await platform.tx.practiceSlug.create({
        data: { slug: SYNTHETIC_SECRET_VALUE, practiceId, retiredAt: RETIRED_AT },
      });
      await platform.tx.practiceSlug.create({ data: { slug: SYNTHETIC_SECRET_VALUE, practiceId } });
    });
  },
} satisfies Record<string, (platform: PlatformTransactionHost) => Promise<unknown>>;

export type ForcedPlatformError = keyof typeof FORCED_PLATFORM_ERRORS;

function isForcedPlatformError(kind: string): kind is ForcedPlatformError {
  return Object.hasOwn(FORCED_PLATFORM_ERRORS, kind);
}

/**
 * Test-only routes under /api/v1/probe/platform-errors (they never exist in src, 02 §12). Each
 * lets its error escape, as a feature would, so the UnknownExceptionFilter logs it.
 */
@Controller('probe/platform-errors')
class PlatformErrorProbeController {
  constructor(
    @InjectTransactionHost('platform') private readonly txHost: PlatformTransactionHost,
  ) {}

  @Public() // test-only: a platform query that fails with a synthetic marker in its input
  @Get(':kind')
  async forceError(@Param('kind') kind: string): Promise<never> {
    if (!isForcedPlatformError(kind)) throw new NotFoundException();
    await FORCED_PLATFORM_ERRORS[kind](this.txHost);
    throw new Error('the forced error did not happen');
  }
}

@Module({ controllers: [PlatformErrorProbeController] })
export class PlatformErrorProbeModule {}

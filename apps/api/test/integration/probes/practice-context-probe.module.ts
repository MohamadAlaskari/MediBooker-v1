import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Controller, Get, Module } from '@nestjs/common';
import { Public } from '../../../src/common/security/public.decorator.js';
import type { PracticeTransactionHost } from '../../../src/common/tenancy/practice-transactional.adapter.js';

/**
 * A test-only route that reads practice data without `@PracticeScoped` (it never exists in src,
 * 02 §12): the bug that the fail-closed request context turns into PracticeContextMissingError
 * (ADR 0005 §2.5) instead of reaching any practice's database.
 */
@Controller('probe/without-practice')
class PracticeContextProbeController {
  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
  ) {}

  @Public() // test-only: practice data on a route without a practice, which must fail closed
  @Get('practice-identity')
  async practiceIdentity(): Promise<never> {
    await this.txHost.tx.practiceIdentity.findUniqueOrThrow({ where: { id: 1 } });
    throw new Error('practice data was read without a resolved practice');
  }
}

@Module({ controllers: [PracticeContextProbeController] })
export class PracticeContextProbeModule {}

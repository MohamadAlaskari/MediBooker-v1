import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Controller, Get, Module } from '@nestjs/common';
import { Public } from '../../src/common/security/public.decorator.js';
import { PracticeScoped } from '../../src/common/tenancy/practice-scoped.decorator.js';
import type { PracticeTransactionHost } from '../../src/common/tenancy/practice-transactional.adapter.js';

/** What a practice database says about itself. */
export interface PracticeIdentityResponse {
  practiceId: string;
}

/**
 * Test-only practice-scoped routes under /api/v1/practices/:practiceId/probe (they never exist in
 * src, 02 §12), for the tenancy specs: the PracticeContextInterceptor resolves the practice from
 * the path and leases its client, and the handler reads `practice_identity` through the `practice`
 * transaction host.
 */
@Controller('practices/:practiceId/probe')
class PracticeProbeController {
  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
  ) {}

  @Public() // test-only: no authentication exists before A01; the practice comes from the path
  @PracticeScoped('id')
  @Get('identity')
  async identity(): Promise<PracticeIdentityResponse> {
    const identity = await this.txHost.tx.practiceIdentity.findUniqueOrThrow({ where: { id: 1 } });
    return { practiceId: identity.practiceId };
  }

  @Public() // test-only: as `identity`, inside a practice transaction
  @PracticeScoped('id')
  @Get('identity-in-transaction')
  identityInTransaction(): Promise<PracticeIdentityResponse> {
    return this.txHost.withTransaction(() => this.identity());
  }

  /** Test-only: a staff route for practice management only, for the capability check (D17). */
  @PracticeScoped('id', { staff: 'management' })
  @Get('admin-only')
  adminOnly(): Promise<PracticeIdentityResponse> {
    return this.identity();
  }
}

@Module({ controllers: [PracticeProbeController] })
export class PracticeProbeModule {}

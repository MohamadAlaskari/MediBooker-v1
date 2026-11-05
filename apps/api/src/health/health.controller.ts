import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/security/public.decorator.js';
import { ReadinessService } from './readiness.service.js';

/**
 * Infrastructure probes, served without `/api` and without a version (02 §10). The proxy does not
 * route them, and they are not logged. X02 adds `@ApiExcludeController()`.
 */
@SkipThrottle() // a rate limit must never fail a liveness probe (a failed probe restarts the container)
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Public() // infrastructure probe: no data, not in the contract
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public() // infrastructure probe (F04): platform database reachable and current, MARKETS set, not draining
  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    await this.readiness.assertReady();
    return { status: 'ok' };
  }
}

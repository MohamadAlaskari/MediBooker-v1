import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/security/public.decorator.js';

/**
 * Infrastructure probes, served without `/api` and without a version (02 §10). The proxy does not
 * route them, and they are not logged. X02 adds `@ApiExcludeController()`, F04 `GET /health/ready`.
 */
@SkipThrottle() // a rate limit must never fail a liveness probe (a failed probe restarts the container)
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @Public() // infrastructure probe: no data, not in the contract
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

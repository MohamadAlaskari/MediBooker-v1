import type { ThrottlerOptions } from '@nestjs/throttler';
import type { Env } from '../../config/env.schema.js';

/**
 * The named throttlers (02 §4), counted per route and address: @nestjs/throttler 6.7.1 keys a
 * bucket by controller, handler, throttler name and `req.ip`, which `trust proxy` derives from
 * TRUST_PROXY_HOPS. Staff of one practice often share one address, so a budget per address
 * across the whole API would throttle them. Only `default` is registered: a public route sets its
 * own limit on it with `@Throttle({ default: … })`, which keeps the plain `Retry-After` header
 * (@nestjs/throttler names it `Retry-After-<name>` for any other throttler).
 */
export function throttlers(env: Env): ThrottlerOptions[] {
  return [{ name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE }];
}

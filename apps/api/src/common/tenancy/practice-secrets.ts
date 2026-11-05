import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { SecretStore } from '../database/secret-store.js';
import { Clock } from '../time/clock.js';
import type { PracticeRoute } from './practice-route.js';

interface CachedSecret {
  readonly value: string;
  readonly expiresAt: number;
}

/**
 * The app passwords of the practices, cached per practice and route version for
 * PRACTICE_SECRET_TTL_MS (02 §5 item 3). A rotation increments the route version, so it never
 * hits an old entry; after an authentication failure the caller reads the password again once.
 */
@Injectable()
export class PracticeSecrets {
  private readonly passwords = new Map<string, CachedSecret>();
  private readonly ttlMs: number;

  constructor(
    private readonly store: SecretStore,
    private readonly clock: Clock,
    @Inject(ENV) env: Env,
  ) {
    this.ttlMs = env.PRACTICE_SECRET_TTL_MS;
  }

  /** The password of the route's app role; `fresh` skips the cache. */
  async appPassword(route: PracticeRoute, fresh: boolean): Promise<string> {
    const key = `${route.id}:${String(route.routeVersion)}`;
    const cached = this.passwords.get(key);
    if (!fresh && cached !== undefined && this.now() < cached.expiresAt) return cached.value;
    const value = await this.store.get(route.appSecretRef);
    const now = this.now();
    for (const [otherKey, other] of this.passwords) {
      if (other.expiresAt <= now) this.passwords.delete(otherKey);
    }
    this.passwords.set(key, { value, expiresAt: now + this.ttlMs });
    return value;
  }

  private now(): number {
    return this.clock.now().epochMilliseconds;
  }
}

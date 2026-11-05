import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../context/request-context.js';
import { Clock } from '../time/clock.js';
import { requirePracticeContext } from './practice-context.js';

interface CachedValue {
  readonly value: unknown;
  readonly expiresAt: number;
}

/**
 * The only cache of practice data in the process (ADR 0005 §10): every key starts with the
 * resolved practice's id and route version, taken from the request context, so a value of one
 * practice can never answer another, and a restore or move (a new route version) starts empty.
 * Without a resolved practice it throws PracticeContextMissingError. Singleton rows have id 1 in
 * every practice database, which is why a key from table and id alone is forbidden.
 */
@Injectable()
export class PracticeCache {
  private readonly values = new Map<string, CachedValue>();

  constructor(
    private readonly cls: ClsService<RequestContext>,
    private readonly clock: Clock,
  ) {}

  /** The key of `name` for the current practice. */
  keyOf(name: string): string {
    const { practice } = requirePracticeContext(this.cls);
    return `${practice.id}:${String(practice.routeVersion)}:${name}`;
  }

  /** The current practice's value of `name`, loaded when it is missing or older than `ttlMs`. */
  async getOrLoad<T>(name: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const key = this.keyOf(name);
    const cached = this.values.get(key);
    // The key holds only values that `load` of the same name returned.
    if (cached !== undefined && this.now() < cached.expiresAt) return cached.value as T;
    const value = await load();
    const now = this.now();
    for (const [otherKey, other] of this.values) {
      if (other.expiresAt <= now) this.values.delete(otherKey);
    }
    this.values.set(key, { value, expiresAt: now + ttlMs });
    return value;
  }

  private now(): number {
    return this.clock.now().epochMilliseconds;
  }
}

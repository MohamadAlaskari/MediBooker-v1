import { createHmac, hkdfSync } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { PlatformPrismaService } from '../database/platform-prisma.service.js';
import { SecretStore } from '../database/secret-store.js';
import { type FieldKey, fieldKeyOf, openField, sealField } from '../security/field-crypto.js';
import { Clock } from '../time/clock.js';
import { PracticeUnavailableError } from './practice-errors.js';

const DERIVED_KEY_BYTES = 32;
/** Less would make the hashes computable: nothing else about them is secret. */
const DEPLOYMENT_KEY_MIN_BYTES = 32;

/** What a keyed hash is for: a key per purpose and practice, so that none compares with another. */
export type KeyedHashPurpose = 'insurance-number' | 'ip-address' | 'idempotency-request';

interface CachedKeys {
  readonly keys: readonly FieldKey[];
  readonly expiresAt: number;
}

/**
 * The keys of a practice's own fields (ADR 0005 §4.8): its data keys from the registry's references,
 * the first encrypts and all decrypt, and keyed hashes with a key derived per practice from the
 * deployment key. So the same number differs in two practices, and destroying a practice's keys
 * makes every remaining copy of its encrypted data unreadable. Keys are cached like the practice
 * passwords (PRACTICE_SECRET_TTL_MS). A practice without a key is unavailable, never unencrypted.
 */
@Injectable()
export class PracticeKeys {
  private readonly cached = new Map<string, CachedKeys>();
  private deploymentKey: Promise<string> | undefined;
  private readonly ttlMs: number;

  constructor(
    private readonly platform: PlatformPrismaService,
    private readonly store: SecretStore,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.ttlMs = env.PRACTICE_SECRET_TTL_MS;
  }

  async encrypt(practiceId: string, plaintext: string, context: string): Promise<string> {
    const [current] = await this.keysOf(practiceId);
    if (current === undefined) {
      throw new PracticeUnavailableError(practiceId, 'PRACTICE_ROUTE_INCOMPLETE');
    }
    return sealField(current, plaintext, context);
  }

  /** The plaintext; throws when a key is unknown, or the value or its context was changed. */
  async decrypt(practiceId: string, value: string, context: string): Promise<string> {
    return openField(await this.keysOf(practiceId), value, context);
  }

  /** HMAC-SHA256 under HKDF(deployment key, practice id, purpose): for equality, not for reading. */
  async keyedHash(practiceId: string, purpose: KeyedHashPurpose, value: string): Promise<string> {
    const derived = hkdfSync(
      'sha256',
      await this.deploymentKeyBytes(practiceId),
      practiceId,
      purpose,
      DERIVED_KEY_BYTES,
    );
    return createHmac('sha256', Buffer.from(derived)).update(value, 'utf8').digest('base64url');
  }

  private async keysOf(practiceId: string): Promise<readonly FieldKey[]> {
    const now = this.clock.now().epochMilliseconds;
    const known = this.cached.get(practiceId);
    if (known !== undefined && now < known.expiresAt) return known.keys;
    const row = await this.platform.practice.findUnique({
      where: { id: practiceId },
      select: { fieldKeyRefs: true },
    });
    const keys = await this.resolved(practiceId, row?.fieldKeyRefs ?? []);
    for (const [otherId, other] of this.cached) {
      if (other.expiresAt <= now) this.cached.delete(otherId);
    }
    this.cached.set(practiceId, { keys, expiresAt: now + this.ttlMs });
    return keys;
  }

  /** A key the store cannot give is the practice's unavailability, answered with 503. */
  private async resolved(
    practiceId: string,
    references: readonly string[],
  ): Promise<readonly FieldKey[]> {
    try {
      return await Promise.all(references.map((reference) => fieldKeyOf(this.store, reference)));
    } catch (cause) {
      throw new PracticeUnavailableError(practiceId, 'PRACTICE_SECRET_UNAVAILABLE', { cause });
    }
  }

  private async deploymentKeyBytes(practiceId: string): Promise<Buffer> {
    this.deploymentKey ??= this.store.get(this.env.BLIND_INDEX_KEY_REF);
    try {
      const bytes = Buffer.from(await this.deploymentKey, 'base64url');
      if (bytes.length < DEPLOYMENT_KEY_MIN_BYTES) throw new Error('a deployment key too short');
      return bytes;
    } catch (cause) {
      // The next request asks the store again.
      this.deploymentKey = undefined;
      throw new PracticeUnavailableError(practiceId, 'PRACTICE_SECRET_UNAVAILABLE', { cause });
    }
  }
}

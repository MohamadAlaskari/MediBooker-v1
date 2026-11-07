import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { SecretStore } from '../database/secret-store.js';
import { type FieldKey, fieldKeyOf, openField, sealField } from './field-crypto.js';

/**
 * Encrypts single fields of the platform database with AES-256-GCM (ADR 0005 §4.8). The keys come
 * from the secret store: the first encrypts and all decrypt, so a key can be replaced row by row.
 * The context binds a value to its place, so a value copied to another row or field does not open.
 * A practice's own fields use PracticeKeys.
 */
@Injectable()
export class FieldCipher {
  private keys: Promise<readonly FieldKey[]> | undefined;

  constructor(
    private readonly store: SecretStore,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async loaded(): Promise<readonly FieldKey[]> {
    this.keys ??= Promise.all(
      this.env.FIELD_ENCRYPTION_KEY_REFS.map((reference) => fieldKeyOf(this.store, reference)),
    );
    try {
      return await this.keys;
    } catch (error) {
      // The next request asks the store again.
      this.keys = undefined;
      throw error;
    }
  }

  async encrypt(plaintext: string, context: string): Promise<string> {
    const [current] = await this.loaded();
    if (current === undefined) throw new Error('no field key');
    return sealField(current, plaintext, context);
  }

  /** The plaintext; throws when a key is unknown, or the value or its context was changed. */
  async decrypt(value: string, context: string): Promise<string> {
    return openField(await this.loaded(), value, context);
  }
}

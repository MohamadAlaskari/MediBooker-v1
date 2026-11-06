import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { SecretStore } from '../database/secret-store.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const KEY_ID_LENGTH = 16;

interface FieldKey {
  readonly id: string;
  readonly key: Buffer;
}

async function fieldKeyOf(store: SecretStore, reference: string): Promise<FieldKey> {
  const key = Buffer.from(await store.get(reference), 'base64url');
  if (key.length !== KEY_BYTES) throw new Error('a field key of the wrong length');
  const id = createHash('sha256').update(key).digest('base64url').slice(0, KEY_ID_LENGTH);
  return { id, key };
}

/**
 * Encrypts single fields of the platform database with AES-256-GCM (ADR 0005 §4.8). The keys come
 * from the secret store: the first encrypts and all decrypt, so a key can be replaced row by row.
 * The context binds a value to its place, so a value copied to another row or field does not open.
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
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, current.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [current.id, iv, ciphertext, cipher.getAuthTag()]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  /** The plaintext; throws when a key is unknown, or the value or its context was changed. */
  async decrypt(value: string, context: string): Promise<string> {
    const [id, iv, ciphertext, tag] = value.split('.');
    const field = (await this.loaded()).find((key) => key.id === id);
    if (field === undefined || iv === undefined || ciphertext === undefined || tag === undefined) {
      throw new Error('a field value that cannot be opened');
    }
    const decipher = createDecipheriv(ALGORITHM, field.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SecretStore } from '../database/secret-store.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const KEY_ID_LENGTH = 16;

/** A data key and the id a value names it by, so that a key can be replaced row by row. */
export interface FieldKey {
  readonly id: string;
  readonly key: Buffer;
}

export async function fieldKeyOf(store: SecretStore, reference: string): Promise<FieldKey> {
  const key = Buffer.from(await store.get(reference), 'base64url');
  if (key.length !== KEY_BYTES) throw new Error('a field key of the wrong length');
  const id = createHash('sha256').update(key).digest('base64url').slice(0, KEY_ID_LENGTH);
  return { id, key };
}

/** AES-256-GCM. The context binds a value to its place: copied elsewhere, it does not open. */
export function sealField({ id, key }: FieldKey, plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [id, iv, ciphertext, cipher.getAuthTag()]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** The plaintext; throws when a key is unknown, or the value or its context was changed. */
export function openField(keys: readonly FieldKey[], value: string, context: string): string {
  const [id, iv, ciphertext, tag] = value.split('.');
  const field = keys.find((key) => key.id === id);
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

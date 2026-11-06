import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env.schema.js';
import { DevSecretStore } from '../database/secret-store.js';
import { FieldCipher } from './field-cipher.js';

const STORE = new DevSecretStore('synthetic-test-seed');
const CONTEXT = 'account-profile:1:insurance-number';

function cipherWith(references: readonly string[]): FieldCipher {
  return new FieldCipher(STORE, { FIELD_ENCRYPTION_KEY_REFS: references } as unknown as Env);
}

describe('FieldCipher', () => {
  const cipher = cipherWith(['dev:one']);

  it('opens what it closed, and the stored value does not show it', async () => {
    const stored = await cipher.encrypt('AN-4821-77', CONTEXT);
    expect(stored).not.toContain('AN-4821-77');
    expect(await cipher.decrypt(stored, CONTEXT)).toBe('AN-4821-77');
  });

  it('never writes the same value twice in the same form', async () => {
    const first = await cipher.encrypt('AN-4821-77', CONTEXT);
    expect(await cipher.encrypt('AN-4821-77', CONTEXT)).not.toBe(first);
  });

  it('does not open a value copied to another place', async () => {
    const stored = await cipher.encrypt('AN-4821-77', CONTEXT);
    await expect(cipher.decrypt(stored, 'account-profile:2:insurance-number')).rejects.toThrow();
  });

  it('does not open a changed value', async () => {
    const [id, iv, , tag] = (await cipher.encrypt('AN-4821-77', CONTEXT)).split('.');
    const forged = Buffer.from('another value').toString('base64url');
    await expect(
      cipher.decrypt(`${id ?? ''}.${iv ?? ''}.${forged}.${tag ?? ''}`, CONTEXT),
    ).rejects.toThrow();
  });

  it('keeps opening old values while a new key encrypts', async () => {
    const before = await cipher.encrypt('AN-4821-77', CONTEXT);
    const rotated = cipherWith(['dev:new', 'dev:one']);
    expect(await rotated.decrypt(before, CONTEXT)).toBe('AN-4821-77');
    const after = await rotated.encrypt('AN-4821-77', CONTEXT);
    await expect(cipher.decrypt(after, CONTEXT)).rejects.toThrow();
  });

  it('refuses a value in another form, and a key of the wrong length', async () => {
    await expect(cipher.decrypt('not-a-value', CONTEXT)).rejects.toThrow();
    const wrong = new FieldCipher({ get: () => Promise.resolve('too-short') }, {
      FIELD_ENCRYPTION_KEY_REFS: ['any'],
    } as unknown as Env);
    await expect(wrong.encrypt('AN-4821-77', CONTEXT)).rejects.toThrow('wrong length');
  });
});

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TEST_ENV } from '../../../test/support/test-env.js';
import { parseEnv } from '../../config/env.schema.js';
import {
  DevSecretStore,
  SecretUnavailableError,
  secretStoreFor,
  UnconfiguredSecretStore,
} from './secret-store.js';

const SEED = 'synthetic-test-seed';

describe('DevSecretStore (ADR 0005 §4.6)', () => {
  it('resolves dev:<name> to HMAC-SHA256 of the name keyed with the seed, in base64url, as medibooker-db derives it', async () => {
    const name = 'practice_0000000000004000800000000000000a_app';
    const expected = createHmac('sha256', SEED).update(name, 'utf8').digest('base64url');
    await expect(new DevSecretStore(SEED).get(`dev:${name}`)).resolves.toBe(expected);
    expect(expected).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('derives a different secret for another name or another seed, and the same one again', async () => {
    const store = new DevSecretStore(SEED);
    const first = await store.get('dev:a');
    expect(await store.get('dev:a')).toBe(first);
    expect(await store.get('dev:b')).not.toBe(first);
    expect(await new DevSecretStore('another-seed').get('dev:a')).not.toBe(first);
  });

  it.each(['env:PLATFORM_APP_PASSWORD', 'dev:', 'vault:practice/a', 'practice_a_app', ''])(
    'refuses the reference %j without naming it',
    async (reference) => {
      const rejection = new DevSecretStore(SEED).get(reference);
      await expect(rejection).rejects.toBeInstanceOf(SecretUnavailableError);
      await expect(rejection).rejects.toThrow('secret reference not resolved');
    },
  );
});

describe('UnconfiguredSecretStore', () => {
  it('refuses every reference, so every practice fails closed until OPS01', async () => {
    await expect(new UnconfiguredSecretStore().get()).rejects.toBeInstanceOf(
      SecretUnavailableError,
    );
  });
});

describe('secretStoreFor', () => {
  it('takes the development store for SECRET_STORE=dev and the refusing one when it is unset', () => {
    expect(secretStoreFor(parseEnv(TEST_ENV))).toBeInstanceOf(DevSecretStore);
    expect(
      secretStoreFor(parseEnv({ ...TEST_ENV, SECRET_STORE: '', DEV_SECRET_SEED: '' })),
    ).toBeInstanceOf(UnconfiguredSecretStore);
  });
});

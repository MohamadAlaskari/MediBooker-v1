import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env.schema.js';
import { DevSecretStore, SecretUnavailableError } from '../database/secret-store.js';
import { AuthSecrets, sameSecret } from './auth-secrets.js';

const ENV = { AUTH_SECRET_REF: 'dev:auth-secret' } as unknown as Env;

describe('AuthSecrets', () => {
  const secrets = new AuthSecrets(new DevSecretStore('synthetic-test-seed'), ENV);

  it('derives the same value for the same input, and another for another purpose', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(await secrets.csrfTokenOf(id)).toBe(await secrets.csrfTokenOf(id));
    expect(await secrets.csrfTokenOf(id)).not.toBe(await secrets.accountTokenOf(id));
  });

  it('refuses a secret too short to protect anything', async () => {
    const short = new AuthSecrets({ get: () => Promise.resolve('too-short') }, ENV);
    await expect(short.csrfTokenOf('any')).rejects.toBeInstanceOf(SecretUnavailableError);
  });

  it('asks the store again after a failure', async () => {
    const values = [Promise.reject(new SecretUnavailableError()), Promise.resolve('x'.repeat(32))];
    const flaky = new AuthSecrets(
      { get: () => values.shift() ?? Promise.reject(new Error()) },
      ENV,
    );
    await expect(flaky.csrfTokenOf('any')).rejects.toBeInstanceOf(SecretUnavailableError);
    await expect(flaky.csrfTokenOf('any')).resolves.toEqual(expect.any(String));
  });
});

describe('sameSecret', () => {
  it('tells equal from different, also at different lengths', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abd')).toBe(false);
    expect(sameSecret('abc', 'abcd')).toBe(false);
  });
});

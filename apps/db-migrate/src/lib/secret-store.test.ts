import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDevSecretStore, deriveDevSecret } from './secret-store.ts';

const SEED = 'synthetic-dev-seed';

describe('deriveDevSecret', () => {
  it("is HMAC-SHA256 keyed with the seed over the name, base64url (the API's derivation)", () => {
    const expected = createHmac('sha256', SEED)
      .update('practice_00000000000040008000000000000001_app', 'utf8')
      .digest('base64url');
    expect(deriveDevSecret(SEED, 'practice_00000000000040008000000000000001_app')).toBe(expected);
    expect(expected).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('differs per name and per seed', () => {
    expect(deriveDevSecret(SEED, 'a_app')).not.toBe(deriveDevSecret(SEED, 'a_owner'));
    expect(deriveDevSecret(SEED, 'a_app')).not.toBe(deriveDevSecret('other-seed', 'a_app'));
  });
});

describe('createDevSecretStore', () => {
  const store = createDevSecretStore({
    appEnv: 'ci',
    seed: SEED,
    environment: {
      PROVISIONER_DATABASE_URL: 'postgresql://synthetic@127.0.0.1/postgres',
      BLANK: ' ',
    },
  });

  it('resolves dev: references by derivation, for get and ensure alike', async () => {
    await expect(store.get('dev:practice_x_app')).resolves.toBe(
      deriveDevSecret(SEED, 'practice_x_app'),
    );
    await expect(store.ensure('dev:practice_x_app')).resolves.toBe(
      deriveDevSecret(SEED, 'practice_x_app'),
    );
  });

  it('resolves env: references to the variable of its environment', async () => {
    await expect(store.get('env:PROVISIONER_DATABASE_URL')).resolves.toBe(
      'postgresql://synthetic@127.0.0.1/postgres',
    );
  });

  it.each([
    'env:MISSING',
    'env:BLANK',
    'env:lowercase',
    'dev:',
    'dev:Upper',
    'dev:has space',
    'vault:practice_x_app',
    'practice_x_app',
  ])('refuses %j with SECRET_UNRESOLVABLE, without repeating the reference', async (ref) => {
    const error: unknown = await store.get(ref).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'SECRET_UNRESOLVABLE' });
    expect(String(error)).toBe('ToolError: SECRET_UNRESOLVABLE');
  });

  it.each(['staging', 'production'] as const)('is refused with APP_ENV %s', (appEnv) => {
    expect(() => createDevSecretStore({ appEnv, seed: SEED, environment: {} })).toThrow(
      expect.objectContaining({ code: 'SECRET_STORE_REFUSED' }),
    );
  });

  it.each([undefined, '', '   '])('needs a seed (%j counts as unset)', (seed) => {
    expect(() => createDevSecretStore({ appEnv: 'local', seed, environment: {} })).toThrow(
      expect.objectContaining({ code: 'SECRET_STORE_UNAVAILABLE' }),
    );
  });
});

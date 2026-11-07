import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.schema.js';
import type { PlatformPrismaService } from '../database/platform-prisma.service.js';
import { DevSecretStore, type SecretStore } from '../database/secret-store.js';
import { FixedClock } from '../time/fixed-clock.js';
import { PracticeUnavailableError } from './practice-errors.js';
import { PracticeKeys } from './practice-keys.js';

const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const PRACTICE_A = '00000000-0000-4000-8000-00000000000a';
const PRACTICE_B = '00000000-0000-4000-8000-00000000000b';
const CONTEXT = 'patient:1:insurance-number';

/** PracticeKeys over a registry that says which references each practice has. */
function keysWith(references: Record<string, readonly string[]>, ttlMs = 60_000) {
  const clock = new FixedClock(NOW);
  const findUnique = vi.fn(({ where: { id } }: { where: { id: string } }) =>
    Promise.resolve(references[id] === undefined ? null : { fieldKeyRefs: references[id] }),
  );
  const platform = { practice: { findUnique } } as unknown as PlatformPrismaService;
  const env = { PRACTICE_SECRET_TTL_MS: ttlMs, BLIND_INDEX_KEY_REF: 'dev:deployment' } as Env;
  return {
    keys: new PracticeKeys(platform, new DevSecretStore('seed'), clock, env),
    clock,
    findUnique,
  };
}

describe('PracticeKeys', () => {
  it('opens what it sealed, in the same place only', async () => {
    const { keys } = keysWith({ [PRACTICE_A]: ['dev:a1'] });
    const sealed = await keys.encrypt(PRACTICE_A, 'A123456789', CONTEXT);
    expect(sealed).not.toContain('A123456789');
    await expect(keys.decrypt(PRACTICE_A, sealed, CONTEXT)).resolves.toBe('A123456789');
    await expect(keys.decrypt(PRACTICE_A, sealed, 'patient:2:insurance-number')).rejects.toThrow();
  });

  it('never opens the value of another practice', async () => {
    const { keys } = keysWith({ [PRACTICE_A]: ['dev:a1'], [PRACTICE_B]: ['dev:b1'] });
    const sealed = await keys.encrypt(PRACTICE_A, 'A123456789', CONTEXT);
    await expect(keys.decrypt(PRACTICE_B, sealed, CONTEXT)).rejects.toThrow();
  });

  it('encrypts with the first key after a rotation and still opens with the old one', async () => {
    const before = keysWith({ [PRACTICE_A]: ['dev:old'] });
    const sealedBefore = await before.keys.encrypt(PRACTICE_A, 'A123456789', CONTEXT);

    const after = keysWith({ [PRACTICE_A]: ['dev:new', 'dev:old'] });
    await expect(after.keys.decrypt(PRACTICE_A, sealedBefore, CONTEXT)).resolves.toBe('A123456789');
    const sealedAfter = await after.keys.encrypt(PRACTICE_A, 'A123456789', CONTEXT);
    expect(sealedAfter.split('.')[0]).not.toBe(sealedBefore.split('.')[0]);

    const onlyOld = keysWith({ [PRACTICE_A]: ['dev:old'] });
    await expect(onlyOld.keys.decrypt(PRACTICE_A, sealedAfter, CONTEXT)).rejects.toThrow();
  });

  it('refuses to encrypt for a practice without a key, and does not store it in the clear', async () => {
    const { keys } = keysWith({ [PRACTICE_A]: [] });
    await expect(keys.encrypt(PRACTICE_A, 'A123456789', CONTEXT)).rejects.toBeInstanceOf(
      PracticeUnavailableError,
    );
  });

  it('answers an unresolvable reference as the unavailability of the practice', async () => {
    const { keys } = keysWith({ [PRACTICE_A]: ['hosted:not-in-this-store'] });
    await expect(keys.encrypt(PRACTICE_A, 'x', CONTEXT)).rejects.toMatchObject({
      reason: 'PRACTICE_SECRET_UNAVAILABLE',
    });
  });

  it('refuses a deployment key too short to keep the hashes from being computed', async () => {
    const store = { get: vi.fn().mockResolvedValue('c2hvcnQ') } as unknown as SecretStore;
    const platform = {} as PlatformPrismaService;
    const env = { PRACTICE_SECRET_TTL_MS: 0, BLIND_INDEX_KEY_REF: 'hosted:short' } as Env;
    const keys = new PracticeKeys(platform, store, new FixedClock(NOW), env);
    await expect(keys.keyedHash(PRACTICE_A, 'ip-address', 'x')).rejects.toMatchObject({
      reason: 'PRACTICE_SECRET_UNAVAILABLE',
    });
  });

  it('reads the references once within the time to live, and again after it', async () => {
    const { keys, clock, findUnique } = keysWith({ [PRACTICE_A]: ['dev:a1'] }, 1000);
    await keys.encrypt(PRACTICE_A, 'x', CONTEXT);
    await keys.encrypt(PRACTICE_A, 'x', CONTEXT);
    expect(findUnique).toHaveBeenCalledTimes(1);
    clock.advance(Temporal.Duration.from({ seconds: 2 }));
    await keys.encrypt(PRACTICE_A, 'x', CONTEXT);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('hashes the same value differently per practice and per purpose, and stably', async () => {
    const { keys } = keysWith({});
    const first = await keys.keyedHash(PRACTICE_A, 'insurance-number', 'A123456789');
    expect(await keys.keyedHash(PRACTICE_A, 'insurance-number', 'A123456789')).toBe(first);
    expect(await keys.keyedHash(PRACTICE_B, 'insurance-number', 'A123456789')).not.toBe(first);
    expect(await keys.keyedHash(PRACTICE_A, 'ip-address', 'A123456789')).not.toBe(first);
    expect(first).not.toContain('A123456789');
  });
});

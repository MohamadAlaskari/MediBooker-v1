import { describe, expect, it, vi } from 'vitest';
import { PRACTICE_A, PRACTICE_B, practiceRoute } from '../../../test/support/practice-routes.js';
import { TEST_ENV } from '../../../test/support/test-env.js';
import { parseEnv } from '../../config/env.schema.js';
import { FixedClock } from '../time/fixed-clock.js';
import { PracticeSecrets } from './practice-secrets.js';

const TTL_MS = 600_000;

function setUp(ttlMs = TTL_MS): {
  secrets: PracticeSecrets;
  clock: FixedClock;
  get: ReturnType<typeof vi.fn<(reference: string) => Promise<string>>>;
} {
  let version = 0;
  const get = vi.fn((reference: string) => {
    version += 1;
    return Promise.resolve(`${reference}#${String(version)}`);
  });
  const clock = new FixedClock(Temporal.Instant.from('2026-11-16T05:00:00Z'));
  const env = parseEnv({ ...TEST_ENV, PRACTICE_SECRET_TTL_MS: String(ttlMs) });
  return { secrets: new PracticeSecrets({ get }, clock, env), clock, get };
}

describe('PracticeSecrets (02 §5 item 3)', () => {
  it('reads the app password once per practice and route version within PRACTICE_SECRET_TTL_MS', async () => {
    const { secrets, get } = setUp();
    const route = practiceRoute(PRACTICE_A);
    const first = await secrets.appPassword(route, false);
    expect(await secrets.appPassword(route, false)).toBe(first);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(route.appSecretRef);
  });

  it('reads it again after the TTL, for another practice and for a new route version', async () => {
    const { secrets, clock, get } = setUp();
    const route = practiceRoute(PRACTICE_A);
    await secrets.appPassword(route, false);
    clock.advance({ milliseconds: TTL_MS - 1 });
    await secrets.appPassword(route, false);
    expect(get).toHaveBeenCalledTimes(1);
    clock.advance({ milliseconds: 1 });
    await secrets.appPassword(route, false);
    await secrets.appPassword(practiceRoute(PRACTICE_B), false);
    await secrets.appPassword(practiceRoute(PRACTICE_A, { routeVersion: 2 }), false);
    expect(get).toHaveBeenCalledTimes(4);
  });

  it('reads it again when asked for a fresh one, after an authentication failure', async () => {
    const { secrets, get } = setUp();
    const route = practiceRoute(PRACTICE_A);
    const cached = await secrets.appPassword(route, false);
    const fresh = await secrets.appPassword(route, true);
    expect(fresh).not.toBe(cached);
    expect(await secrets.appPassword(route, false)).toBe(fresh);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('never caches with a TTL of 0', async () => {
    const { secrets, get } = setUp(0);
    const route = practiceRoute(PRACTICE_A);
    await secrets.appPassword(route, false);
    await secrets.appPassword(route, false);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('passes a refusal of the store on, and caches nothing', async () => {
    const { secrets, get } = setUp();
    get.mockRejectedValueOnce(new Error('refused'));
    const route = practiceRoute(PRACTICE_A);
    await expect(secrets.appPassword(route, false)).rejects.toThrow('refused');
    await secrets.appPassword(route, false);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

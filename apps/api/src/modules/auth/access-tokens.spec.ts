import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DevSecretStore } from '../../common/database/secret-store.js';
import { FixedClock } from '../../common/time/fixed-clock.js';
import type { Env } from '../../config/env.schema.js';
import { AccessTokens } from './access-tokens.js';

const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const ACTOR = {
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  amr: ['pwd'],
};

function tokensWith(references: readonly string[], clock = new FixedClock(NOW)): AccessTokens {
  return new AccessTokens(new DevSecretStore('synthetic-test-seed'), clock, {
    AUTH_SIGNING_KEY_REFS: references,
  } as unknown as Env);
}

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as Record<
    string,
    unknown
  >;
}

describe('AccessTokens', () => {
  it('round-trips the actor, with no role in the token', async () => {
    const tokens = tokensWith(['dev:one']);
    const token = await tokens.issue(ACTOR);
    expect(await tokens.verify(token)).toEqual(ACTOR);
    expect(claimsOf(token)).toMatchObject({
      iss: 'medibooker',
      aud: 'medibooker-api',
      sub: ACTOR.userId,
      sid: ACTOR.sessionId,
      amr: ['pwd'],
    });
    expect(claimsOf(token)).not.toHaveProperty('role');
  });

  it('lasts 15 minutes', async () => {
    const clock = new FixedClock(NOW);
    const tokens = tokensWith(['dev:one'], clock);
    const token = await tokens.issue(ACTOR);
    clock.set(NOW.add({ minutes: 14, seconds: 59 }));
    expect(await tokens.verify(token)).toEqual(ACTOR);
    clock.set(NOW.add({ minutes: 15 }));
    expect(await tokens.verify(token)).toBeUndefined();
  });

  it('keeps tokens of the old key valid while a new one signs', async () => {
    const before = await tokensWith(['dev:old']).issue(ACTOR);
    const rotated = tokensWith(['dev:new', 'dev:old']);
    expect(await rotated.verify(before)).toEqual(ACTOR);
    expect(await tokensWith(['dev:old']).verify(await rotated.issue(ACTOR))).toBeUndefined();
  });

  it('refuses a token of another key', async () => {
    const token = await tokensWith(['dev:one']).issue(ACTOR);
    expect(await tokensWith(['dev:two']).verify(token)).toBeUndefined();
  });

  it('refuses a changed token', async () => {
    const tokens = tokensWith(['dev:one']);
    const [header, , signature] = (await tokens.issue(ACTOR)).split('.');
    const payload = Buffer.from(JSON.stringify({ ...ACTOR, sub: 'someone-else' })).toString(
      'base64url',
    );
    expect(await tokens.verify(`${header ?? ''}.${payload}.${signature ?? ''}`)).toBeUndefined();
  });

  it('refuses a token without a signature, and one signed with a shared secret', async () => {
    const tokens = tokensWith(['dev:one']);
    const payload = (await tokens.issue(ACTOR)).split('.')[1] ?? '';
    const none = Buffer.from('{"alg":"none"}').toString('base64url');
    expect(await tokens.verify(`${none}.${payload}.`)).toBeUndefined();
    const hs256 = Buffer.from('{"alg":"HS256"}').toString('base64url');
    const signature = createHmac('sha256', 'secret')
      .update(`${hs256}.${payload}`)
      .digest('base64url');
    expect(await tokens.verify(`${hs256}.${payload}.${signature}`)).toBeUndefined();
  });

  it('refuses what is no token at all', async () => {
    const tokens = tokensWith(['dev:one']);
    expect(await tokens.verify('not-a-token')).toBeUndefined();
    expect(await tokens.verify('')).toBeUndefined();
  });

  it('fails closed without a key in the store', async () => {
    const tokens = tokensWith(['not-a-dev-reference']);
    await expect(tokens.issue(ACTOR)).rejects.toThrow();
  });

  it('refuses a key of the wrong length', async () => {
    const store = { get: () => Promise.resolve('too-short') };
    const tokens = new AccessTokens(store, new FixedClock(NOW), {
      AUTH_SIGNING_KEY_REFS: ['any'],
    } as unknown as Env);
    await expect(tokens.issue(ACTOR)).rejects.toThrow('wrong length');
  });
});

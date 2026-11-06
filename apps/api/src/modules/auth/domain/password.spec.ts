import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';
import { isBreachedPassword } from './password-policy.js';

const PASSWORD = 'synthetic correct horse battery';

describe('hashPassword', () => {
  it('writes argon2id with the parameters of ADR 0004', async () => {
    expect(await hashPassword(PASSWORD)).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/,
    );
  });

  it('salts: the same password gives another hash', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });
});

describe('verifyPassword', () => {
  it('accepts the password and nothing else', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, `${PASSWORD} `)).toBe(false);
  });

  it('accepts the same text in another Unicode form', async () => {
    const composed = 'كلمةٌ سرٌّ آخر طويلة';
    const hash = await hashPassword(composed);
    expect(await verifyPassword(hash, composed.normalize('NFD'))).toBe(true);
  });

  it('refuses a hash in another format instead of failing', async () => {
    expect(await verifyPassword('not a hash', PASSWORD)).toBe(false);
    expect(await verifyPassword('$2b$10$abcdefghijklmnopqrstuv', PASSWORD)).toBe(false);
  });
});

describe('isBreachedPassword', () => {
  it('finds a known password of at least the minimum length, whatever its case', () => {
    expect(isBreachedPassword('1234567890')).toBe(true);
    expect(isBreachedPassword('QWERTYUIOP')).toBe(true);
  });

  it('lets a passphrase through', () => {
    expect(isBreachedPassword('synthetic correct horse battery')).toBe(false);
  });
});

import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { scramSha256Verifier } from './scram.ts';

// The SCRAM-SHA-256 exchange of RFC 7677 §3: user "user", password "pencil".
const RFC_SALT = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
const RFC_AUTH_MESSAGE = [
  'n=user,r=rOprNGfwEbeRWgbNEkqO',
  'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096',
  'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0',
].join(',');
const RFC_CLIENT_PROOF = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64');
const RFC_SERVER_SIGNATURE = '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=';

const VERIFIER_FORMAT =
  /^SCRAM-SHA-256\$4096:([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/;

function parse(verifier: string): { salt: Buffer; stored: Buffer; server: Buffer } {
  const match = VERIFIER_FORMAT.exec(verifier);
  if (match === null) throw new Error('not a verifier');
  const [, salt = '', stored = '', server = ''] = match;
  return {
    salt: Buffer.from(salt, 'base64'),
    stored: Buffer.from(stored, 'base64'),
    server: Buffer.from(server, 'base64'),
  };
}

describe('scramSha256Verifier', () => {
  it("has PostgreSQL's format with a random 16-byte salt and 32-byte keys", () => {
    const first = parse(scramSha256Verifier('synthetic-password-1'));
    const second = parse(scramSha256Verifier('synthetic-password-1'));
    expect(first.salt).toHaveLength(16);
    expect(first.stored).toHaveLength(32);
    expect(first.server).toHaveLength(32);
    expect(first.salt.equals(second.salt)).toBe(false);
  });

  it('matches the known answer of RFC 7677: the server signature and the client proof', () => {
    const { stored, server } = parse(scramSha256Verifier('pencil', RFC_SALT));
    // The server proves its key with the signature the RFC prints.
    expect(createHmac('sha256', server).update(RFC_AUTH_MESSAGE).digest('base64')).toBe(
      RFC_SERVER_SIGNATURE,
    );
    // The client key recovered from the RFC's proof hashes to the stored key.
    const clientSignature = createHmac('sha256', stored).update(RFC_AUTH_MESSAGE).digest();
    const clientKey = Buffer.from(
      RFC_CLIENT_PROOF.map((byte, index) => byte ^ (clientSignature[index] ?? 0)),
    );
    expect(createHash('sha256').update(clientKey).digest().equals(stored)).toBe(true);
  });

  it('keeps the salt it was given', () => {
    expect(parse(scramSha256Verifier('pencil', RFC_SALT)).salt.equals(RFC_SALT)).toBe(true);
  });

  it.each(['', 'pässword', 'tab\tinside'])(
    'refuses %j: only printable ASCII needs no SASLprep',
    (password) => {
      expect(() => scramSha256Verifier(password)).toThrow(TypeError);
    },
  );

  it('never contains the password', () => {
    expect(scramSha256Verifier('synthetic-password-2')).not.toContain('synthetic-password-2');
  });
});

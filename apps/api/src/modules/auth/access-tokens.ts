import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { errors, jwtVerify, SignJWT, type JWTHeaderParameters } from 'jose';
import { SecretStore } from '../../common/database/secret-store.js';
import type { Actor } from '../../common/security/actor.js';
import { Clock } from '../../common/time/clock.js';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';

const ISSUER = 'medibooker';
const AUDIENCE = 'medibooker-api';
const ALGORITHM = 'EdDSA';
/** ADR 0004 §5: at most 15 minutes; a revocation counts at once through the session row anyway. */
export const ACCESS_TOKEN_SECONDS = 900;

/** The fixed start of a PKCS#8 Ed25519 private key, before its 32 secret bytes. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SEED_BYTES = 32;
const KID_LENGTH = 16;

interface SigningKey {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}

/** A key from its secret: 32 bytes in base64url, which is what the development store gives. */
function signingKeyOf(secret: string): SigningKey {
  const seed = Buffer.from(secret, 'base64url');
  if (seed.length !== SEED_BYTES) throw new Error('auth signing key has the wrong length');
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey);
  const der = publicKey.export({ format: 'der', type: 'spki' });
  const kid = createHash('sha256').update(der).digest('base64url').slice(0, KID_LENGTH);
  return { kid, privateKey, publicKey };
}

/**
 * The access tokens (ADR 0004 §5): asymmetric, with no role in them, because a role comes from the
 * membership in the practice of a request. The first key of AUTH_SIGNING_KEY_REFS signs and all of
 * them verify, so a key can be replaced without signing anyone out.
 */
@Injectable()
export class AccessTokens {
  private keys: Promise<readonly SigningKey[]> | undefined;

  constructor(
    private readonly store: SecretStore,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async signingKeys(): Promise<readonly SigningKey[]> {
    this.keys ??= Promise.all(
      this.env.AUTH_SIGNING_KEY_REFS.map(async (reference) =>
        signingKeyOf(await this.store.get(reference)),
      ),
    );
    try {
      return await this.keys;
    } catch (error) {
      // The next request asks the store again.
      this.keys = undefined;
      throw error;
    }
  }

  async issue({ userId, sessionId, amr }: Actor): Promise<string> {
    const [key] = await this.signingKeys();
    if (key === undefined) throw new Error('no auth signing key');
    const issuedAt = Math.floor(this.clock.now().epochMilliseconds / 1000);
    return new SignJWT({ sid: sessionId, amr: [...amr] })
      .setProtectedHeader({ alg: ALGORITHM, kid: key.kid })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(userId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ACCESS_TOKEN_SECONDS)
      .sign(key.privateKey);
  }

  /** The claims of a token, or undefined for anything that is not one of ours and current. */
  async verify(token: string): Promise<Actor | undefined> {
    const keys = await this.signingKeys();
    const keyFor = ({ kid }: JWTHeaderParameters): KeyObject => {
      const key = keys.find((candidate) => candidate.kid === kid);
      if (key === undefined) throw new errors.JWKSNoMatchingKey();
      return key.publicKey;
    };
    try {
      const { payload } = await jwtVerify(token, keyFor, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: [ALGORITHM],
        currentDate: new Date(this.clock.now().epochMilliseconds),
      });
      const { sub, sid, amr } = payload;
      if (typeof sub !== 'string' || typeof sid !== 'string' || !isStringArray(amr)) {
        return undefined;
      }
      return { userId: sub, sessionId: sid, amr };
    } catch (error) {
      if (error instanceof errors.JOSEError) return undefined;
      throw error;
    }
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

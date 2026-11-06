import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { SecretStore, SecretUnavailableError } from '../database/secret-store.js';

/** The strength of the HMACs below; a shorter value is a mistake in the store. */
const MIN_SECRET_BYTES = 32;

/** The hash a secret value is stored as: the value itself is stored nowhere. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Equality of two strings that does not reveal how much of them matched. */
export function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(a), 'hex'), Buffer.from(sha256(b), 'hex'));
}

/**
 * Values derived from the auth secret of the secret store. The purpose is part of the input, so a
 * value made for one purpose is never valid for another. Unresolved, it fails closed.
 */
@Injectable()
export class AuthSecrets {
  private secret: Promise<string> | undefined;

  constructor(
    private readonly store: SecretStore,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async derive(purpose: string, message: string): Promise<string> {
    this.secret ??= this.resolvedSecret();
    try {
      const secret = await this.secret;
      return createHmac('sha256', secret).update(`${purpose}\0${message}`).digest('base64url');
    } catch (error) {
      // The next request asks the store again.
      this.secret = undefined;
      throw error;
    }
  }

  private async resolvedSecret(): Promise<string> {
    const secret = await this.store.get(this.env.AUTH_SECRET_REF);
    if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) throw new SecretUnavailableError();
    return secret;
  }

  /** What the CSRF header of a session must be: readable by its page, and bound to its session. */
  csrfTokenOf(sessionId: string): Promise<string> {
    return this.derive('csrf', sessionId);
  }

  /** The single-use token of an account token row: derived, so no table or queue holds it. */
  accountTokenOf(accountTokenId: string): Promise<string> {
    return this.derive('account-token', accountTokenId);
  }
}

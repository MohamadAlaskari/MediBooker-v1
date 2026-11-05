import { createHmac } from 'node:crypto';
import type { Env } from '../../config/env.schema.js';

/**
 * The secret-store port (ADR 0005 §4.6): resolves a reference from the registry (`app_secret_ref`,
 * a cluster's `ca_secret_ref`) to its value. The registry holds references only. Neither a
 * reference nor a value is ever logged or put into an error message (02 §8). OPS01 adds the
 * provider of the chosen hosting.
 */
export abstract class SecretStore {
  /** The secret that a reference names; rejects with SecretUnavailableError otherwise. */
  abstract get(reference: string): Promise<string>;
}

/** A reference that the configured store cannot resolve. The message names neither. */
export class SecretUnavailableError extends Error {
  constructor() {
    super('secret reference not resolved');
  }
}

const DEV_REFERENCE_PREFIX = 'dev:';

/**
 * The development store of local and ci (SECRET_STORE=dev): a `dev:<name>` reference resolves to
 * HMAC-SHA256 of the name, keyed with DEV_SECRET_SEED, in base64url. medibooker-db derives the
 * passwords it gives the practice roles the same way, so both agree without storing anything.
 * parseEnv refuses this store outside APP_ENV local and ci.
 */
export class DevSecretStore extends SecretStore {
  constructor(private readonly seed: string) {
    super();
  }

  get(reference: string): Promise<string> {
    const name = reference.startsWith(DEV_REFERENCE_PREFIX)
      ? reference.slice(DEV_REFERENCE_PREFIX.length)
      : '';
    if (name === '') return Promise.reject(new SecretUnavailableError());
    return Promise.resolve(
      createHmac('sha256', this.seed).update(name, 'utf8').digest('base64url'),
    );
  }
}

/**
 * SECRET_STORE unset: no reference resolves, so every practice answers 503 (fail closed) until
 * OPS01 adds the provider of the chosen hosting.
 */
export class UnconfiguredSecretStore extends SecretStore {
  get(): Promise<string> {
    return Promise.reject(new SecretUnavailableError());
  }
}

/** The store that SECRET_STORE selects. */
export function secretStoreFor(env: Env): SecretStore {
  if (env.SECRET_STORE === 'dev' && env.DEV_SECRET_SEED !== undefined) {
    return new DevSecretStore(env.DEV_SECRET_SEED);
  }
  return new UnconfiguredSecretStore();
}

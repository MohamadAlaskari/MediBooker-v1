import { createHmac } from 'node:crypto';
import { isLocalOrCi, type AppEnv } from './app-env.ts';
import { ToolError } from './errors.ts';

/**
 * Where database credentials live (02 §6, ADR 0005 §4.6). The registry stores references only;
 * a reference never appears in output or logs. The production provider arrives in OPS01.
 */
export interface SecretStore {
  /** The secret a reference names; throws SECRET_UNRESOLVABLE when it cannot be resolved. */
  get(ref: string): Promise<string>;
  /**
   * The stored secret, created if absent: 32 random bytes, base64url, in a provider's store.
   * The development store derives every secret, so it creates nothing.
   */
  ensure(ref: string): Promise<string>;
}

export interface DevSecretStoreOptions {
  readonly appEnv: AppEnv;
  /** DEV_SECRET_SEED: every `dev:` secret derives from it. */
  readonly seed: string | undefined;
  /** Where `env:<VARIABLE>` references are read, for example process.env. */
  readonly environment: Readonly<Record<string, string | undefined>>;
}

const DEV_NAME = /^[a-z0-9_]{1,63}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * The secret of `dev:<name>`: HMAC-SHA256 keyed with DEV_SECRET_SEED over the name, base64url.
 * The API's development store derives the same value (the integration specs prove it).
 */
export function deriveDevSecret(seed: string, name: string): string {
  return createHmac('sha256', seed).update(name, 'utf8').digest('base64url');
}

/**
 * The development store (SECRET_STORE=dev), accepted only with APP_ENV local or ci: `dev:<name>`
 * derives from DEV_SECRET_SEED, `env:<VARIABLE>` is that variable's value.
 */
export function createDevSecretStore(options: DevSecretStoreOptions): SecretStore {
  if (!isLocalOrCi(options.appEnv)) throw new ToolError('SECRET_STORE_REFUSED');
  // The raw value keys the HMAC, as in the API; a blank seed counts as unset.
  const { seed, environment } = options;
  if (seed === undefined || seed.trim() === '') throw new ToolError('SECRET_STORE_UNAVAILABLE');

  const resolve = (ref: string): string => {
    if (ref.startsWith('dev:')) {
      const name = ref.slice('dev:'.length);
      if (DEV_NAME.test(name)) return deriveDevSecret(seed, name);
    } else if (ref.startsWith('env:')) {
      const name = ref.slice('env:'.length);
      const value = ENV_NAME.test(name) ? environment[name] : undefined;
      if (value !== undefined && value.trim() !== '') return value;
    }
    throw new ToolError('SECRET_UNRESOLVABLE');
  };

  return {
    get: (ref) => Promise.resolve().then(() => resolve(ref)),
    ensure: (ref) => Promise.resolve().then(() => resolve(ref)),
  };
}

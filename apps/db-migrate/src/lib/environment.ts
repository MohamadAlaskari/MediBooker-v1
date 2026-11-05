import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAppEnv, isLocalOrCi, type AppEnv } from './app-env.ts';
import { parseClusterEndpoints, type ClusterEndpoints } from './cluster.ts';
import type { ConnectionLimits } from './roles.ts';

/** PRISMA_ROOT's default: `../api` from this package, the API with its schemas and configs. */
export const DEFAULT_PRISMA_ROOT = path.resolve(
  fileURLToPath(new URL('../../../api/', import.meta.url)),
);

/** The defaults of 02 §7. */
export const DEFAULT_MIGRATION_CONCURRENCY = 4;
export const DEFAULT_MIGRATION_TIMEOUT_MS = 300_000;
export const DEFAULT_MIGRATION_LOCK_RETRIES = 3;
export const DEFAULT_CONNECTION_LIMITS: ConnectionLimits = { app: 20, owner: 4 };

/** The variables medibooker-db reads (02 §7), parsed once by the CLI and the seed. */
export interface ToolEnvironment {
  readonly appEnv: AppEnv;
  /** PLATFORM_MIGRATION_URL: the platform database as platform_owner. */
  readonly platformUrl: string | undefined;
  /** PROVISIONER_DATABASE_URL (local and ci): registers the cluster `local`. */
  readonly provisionerUrl: string | undefined;
  /** DATABASE_ADMIN_URL (local and ci): the cluster superuser, for reset-local and templates. */
  readonly adminUrl: string | undefined;
  readonly secretStore: 'dev' | undefined;
  readonly devSecretSeed: string | undefined;
  readonly clusterEndpoints: ClusterEndpoints;
  /** MARKETS; required for provisioning in staging and production. */
  readonly markets: readonly string[] | undefined;
  readonly migrationConcurrency: number;
  readonly migrationTimeoutMs: number;
  readonly migrationLockRetries: number;
  readonly connectionLimits: ConnectionLimits;
  readonly prismaRoot: string;
}

export type EnvironmentResult =
  | { readonly ok: true; readonly value: ToolEnvironment }
  | { readonly ok: false; readonly invalidKeys: readonly string[] };

type Source = Readonly<Record<string, string | undefined>>;

const DIGITS = /^\d+$/;
const MARKET = /^[A-Z]{2}$/;

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'postgresql:' || url.protocol === 'postgres:';
  } catch {
    return false;
  }
}

/**
 * Parses the environment of medibooker-db. A blank value counts as unset, integers are decimal
 * digits only, and the tools-only values (the provisioner and superuser URLs, the endpoint
 * override, the development secret store) are accepted only with APP_ENV local or ci. Invalid
 * variables are reported by name, never by value.
 */
export function parseToolEnvironment(source: Source): EnvironmentResult {
  const invalidKeys: string[] = [];
  const read = (key: string): string | undefined => {
    const value = source[key];
    return value === undefined || value.trim() === '' ? undefined : value;
  };

  const appEnvValue = read('APP_ENV');
  const appEnv = appEnvValue !== undefined && isAppEnv(appEnvValue) ? appEnvValue : undefined;
  if (appEnv === undefined) invalidKeys.push('APP_ENV');
  const localOrCi = appEnv !== undefined && isLocalOrCi(appEnv);

  const localOnly = (key: string): string | undefined => {
    const value = read(key);
    if (value !== undefined && appEnv !== undefined && !localOrCi) {
      invalidKeys.push(key);
      return undefined;
    }
    return value;
  };
  const postgresUrl = (key: string, value: string | undefined): string | undefined => {
    if (value === undefined || isPostgresUrl(value)) return value;
    invalidKeys.push(key);
    return undefined;
  };
  const integer = (key: string, fallback: number, min: number, max: number): number => {
    const value = read(key);
    if (value === undefined) return fallback;
    const parsed = DIGITS.test(value) ? Number(value) : Number.NaN;
    if (Number.isSafeInteger(parsed) && parsed >= min && parsed <= max) return parsed;
    invalidKeys.push(key);
    return fallback;
  };

  const platformUrl = postgresUrl('PLATFORM_MIGRATION_URL', read('PLATFORM_MIGRATION_URL'));
  const provisionerUrl = postgresUrl(
    'PROVISIONER_DATABASE_URL',
    localOnly('PROVISIONER_DATABASE_URL'),
  );
  const adminUrl = postgresUrl('DATABASE_ADMIN_URL', localOnly('DATABASE_ADMIN_URL'));

  let clusterEndpoints: ClusterEndpoints = new Map();
  const endpointsValue = localOnly('DATABASE_CLUSTER_ENDPOINTS');
  if (endpointsValue !== undefined) {
    try {
      clusterEndpoints = parseClusterEndpoints(endpointsValue);
    } catch {
      invalidKeys.push('DATABASE_CLUSTER_ENDPOINTS');
    }
  }

  const secretStoreValue = read('SECRET_STORE');
  const secretStore = secretStoreValue === 'dev' && localOrCi ? 'dev' : undefined;
  if (secretStoreValue !== undefined && secretStore === undefined && appEnv !== undefined) {
    invalidKeys.push('SECRET_STORE');
  }
  const devSecretSeed = read('DEV_SECRET_SEED');
  if (secretStore === 'dev' && devSecretSeed === undefined) invalidKeys.push('DEV_SECRET_SEED');

  let markets: string[] | undefined;
  const marketsValue = read('MARKETS');
  if (marketsValue !== undefined) {
    markets = marketsValue.split(',').map((market) => market.trim());
    if (!markets.every((market) => MARKET.test(market))) {
      invalidKeys.push('MARKETS');
      markets = undefined;
    }
  }

  const value: Omit<ToolEnvironment, 'appEnv'> = {
    platformUrl,
    provisionerUrl,
    adminUrl,
    secretStore,
    devSecretSeed,
    clusterEndpoints,
    markets,
    migrationConcurrency: integer('MIGRATION_CONCURRENCY', DEFAULT_MIGRATION_CONCURRENCY, 1, 64),
    migrationTimeoutMs: integer(
      'MIGRATION_TIMEOUT_MS',
      DEFAULT_MIGRATION_TIMEOUT_MS,
      1_000,
      86_400_000,
    ),
    migrationLockRetries: integer('MIGRATION_LOCK_RETRIES', DEFAULT_MIGRATION_LOCK_RETRIES, 0, 10),
    connectionLimits: {
      app: integer('PRACTICE_APP_CONNECTION_LIMIT', DEFAULT_CONNECTION_LIMITS.app, 1, 1000),
      owner: integer('PRACTICE_OWNER_CONNECTION_LIMIT', DEFAULT_CONNECTION_LIMITS.owner, 1, 1000),
    },
    prismaRoot: path.resolve(read('PRISMA_ROOT') ?? DEFAULT_PRISMA_ROOT),
  };
  if (appEnv === undefined || invalidKeys.length > 0) return { ok: false, invalidKeys };
  return { ok: true, value: { appEnv, ...value } };
}

import { z } from 'zod';

/** The raw environment: `process.env` in main.ts, an explicit object in tests. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

const NODE_ENVS = ['development', 'test', 'production'] as const;
const APP_ENVS = ['local', 'ci', 'staging', 'production'] as const;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Levels that drop the error lines 02 §8 needs: allowed in local and ci only. */
const LEVELS_WITHOUT_ERROR_LINES: ReadonlySet<string> = new Set(['fatal', 'silent']);

/** The highest RATE_LIMIT_PER_MINUTE of staging and production; tests use 100000 (02 §12). */
const DEPLOYED_RATE_LIMIT_MAX = 1000;

/** Exactly `true` or `false`. Never z.coerce.boolean(), which reads 'false' as true. */
function strictBoolean() {
  return z.stringbool({ truthy: ['true'], falsy: ['false'], case: 'sensitive' });
}

/** Decimal digits only: z.coerce.number() would also accept '0x1', '1e3' and '+1'. */
function integer(min: number, max: number) {
  return z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(min).max(max));
}

/** `scheme://host[:port]` with http or https: no path, no trailing slash, no wildcard. */
function isOrigin(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
}

/** The entries of a comma-separated list, trimmed, without empty ones. */
function listOf(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

const corsOrigins = z.string().transform((value, ctx) => {
  const origins = listOf(value);
  if (!origins.every(isOrigin)) {
    ctx.addIssue({ code: 'custom', params: { reason: 'not_an_origin' } });
    return z.NEVER;
  }
  return origins;
});

/** A PostgreSQL connection URL with a host, as pg reads it. */
function isPostgresUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (url.protocol === 'postgresql:' || url.protocol === 'postgres:') && url.hostname !== '';
}

/** TLS with certificate and host-name verification, as ADR 0005 §4.9 requires outside local and ci. */
function verifiesServer(value: string): boolean {
  const { searchParams } = new URL(value);
  return (
    searchParams.get('sslmode') === 'verify-full' && (searchParams.get('sslrootcert') ?? '') !== ''
  );
}

const postgresUrl = z.string().superRefine((value, ctx) => {
  if (!isPostgresUrl(value))
    ctx.addIssue({ code: 'custom', params: { reason: 'not_a_postgres_url' } });
});

/** Where the API reaches one database cluster (02 §5). */
export interface ClusterEndpoint {
  readonly host: string;
  readonly port: number;
}

/** A cluster id as `database_clusters` stores it: a lowercase slug such as `local`. */
const CLUSTER_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** `host:port`: a host name, an IPv4 address or a bracketed IPv6 address, and a port. */
const HOST_AND_PORT = /^(?<host>[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\]):(?<port>\d{1,5})$/;

function endpointOf(value: unknown): ClusterEndpoint | undefined {
  const groups = typeof value === 'string' ? HOST_AND_PORT.exec(value)?.groups : undefined;
  if (groups?.host === undefined || groups.port === undefined) return undefined;
  const port = Number(groups.port);
  if (port < 1 || port > 65_535) return undefined;
  return { host: groups.host.replace(/^\[(.*)\]$/, '$1'), port };
}

/**
 * DATABASE_CLUSTER_ENDPOINTS: a JSON object from cluster id to `host:port`, so host processes
 * (`127.0.0.1:5432`) and compose containers (`db:5432`) reach the same cluster. A Map, so a key
 * such as `__proto__` stays an ordinary key.
 */
const clusterEndpoints = z
  .string()
  .transform((value, ctx): ReadonlyMap<string, ClusterEndpoint> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = undefined;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      ctx.addIssue({ code: 'custom', params: { reason: 'not_a_json_object' } });
      return z.NEVER;
    }
    const endpoints = new Map<string, ClusterEndpoint>();
    for (const [clusterId, address] of Object.entries(parsed)) {
      const endpoint = endpointOf(address);
      if (!CLUSTER_ID.test(clusterId) || endpoint === undefined) {
        ctx.addIssue({ code: 'custom', params: { reason: 'not_a_cluster_endpoint_map' } });
        return z.NEVER;
      }
      endpoints.set(clusterId, endpoint);
    }
    return endpoints;
  });

/** ISO 3166-1 alpha-2 codes in upper case, as `practices.market` stores them. */
/**
 * `smtps://`, or STARTTLS the server cannot skip. No other option: nodemailer also reads
 * `tls.rejectUnauthorized`, which turns the certificate check off, and `logger`, which would write
 * the links in e-mails past our log rules.
 */
function isEncryptedSmtp(value: string): boolean {
  const url = new URL(value);
  const encrypted = url.protocol === 'smtps:' || url.searchParams.get('requireTLS') === 'true';
  return encrypted && [...url.searchParams.keys()].every((key) => key === 'requireTLS');
}

/** Where a mail catcher runs: in a Docker stack or on this machine. Nothing leaves it. */
const LOCAL_CATCHER_HOSTS: ReadonlySet<string> = new Set(['mailpit', 'localhost', '127.0.0.1']);

/**
 * Mailpit and the like: no login and no option. Everything else is a real mail server, also in a
 * Docker stack, which runs as `local`.
 */
function isLocalCatcher(value: string): boolean {
  const { hostname, username, password, search } = new URL(value);
  return LOCAL_CATCHER_HOSTS.has(hostname) && username === '' && password === '' && search === '';
}

/** A comma-separated list of e-mail addresses in lower case, as `users.email` stores them. */
const mailAddresses = z.string().transform((value, ctx): readonly string[] => {
  const addresses = listOf(value).map((address) => address.toLowerCase());
  if (addresses.length === 0 || !addresses.every((item) => z.email().safeParse(item).success)) {
    ctx.addIssue({ code: 'custom', params: { reason: 'not_an_address_list' } });
    return z.NEVER;
  }
  return addresses;
});

/** A reference only the development store resolves: refused where that store is. */
function isDevReference(reference: string): boolean {
  return reference.startsWith('dev:');
}

const webOrigin = z.string().refine(isOrigin, { params: { reason: 'not_an_origin' } });

const keyRefs = z
  .string()
  .transform((value) => value.split(',').map((reference) => reference.trim()))
  .pipe(z.array(z.string().min(1)).min(1));

const markets = z.string().transform((value, ctx): readonly string[] => {
  const codes = listOf(value);
  if (!codes.every((code) => /^[A-Z]{2}$/.test(code))) {
    ctx.addIssue({ code: 'custom', params: { reason: 'not_a_market_list' } });
    return z.NEVER;
  }
  return codes;
});

const envObject = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  // Required, no default: a missing value must never fall back to the least restrictive one.
  APP_ENV: z.enum(APP_ENVS),
  PORT: integer(1, 65_535).default(3001),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  LOG_PRETTY: strictBoolean().default(false),
  CORS_ORIGINS: corsOrigins.default([]),
  // Defaults to 0 in local and ci only; staging and production must set it (refinement below).
  TRUST_PROXY_HOPS: integer(0, 10).optional(),
  OPENAPI_UI_ENABLED: strictBoolean().default(false),
  RATE_LIMIT_PER_MINUTE: integer(1, 1_000_000).default(120),
  // F04: the platform database as platform_app; outside local and ci with verify-full TLS.
  PLATFORM_DATABASE_URL: postgresUrl,
  PLATFORM_DATABASE_POOL_MAX: integer(1, 100).default(10),
  // F04: the practice clients and their budgets (02 §5, ADR 0005 §2.2).
  PRACTICE_POOL_MAX: integer(1, 100).default(3),
  PRACTICE_CLIENTS_MAX: integer(1, 10_000).default(40),
  PRACTICE_CLIENT_IDLE_MS: integer(1000, 86_400_000).default(60_000),
  PUBLIC_PRACTICE_CLIENTS_MAX: integer(1, 10_000).default(10),
  /** A request across a person's practices (ADR 0005 §9.1): how many, how many at once, how long. */
  ME_FANOUT_MAX_PRACTICES: integer(1, 100).default(20),
  ME_FANOUT_CONCURRENCY: integer(1, 20).default(4),
  ME_FANOUT_TIMEOUT_MS: integer(1, 60_000).default(2000),
  FANOUT_PRACTICE_CLIENTS_MAX: integer(1, 10_000).default(20),
  JOB_PRACTICE_CLIENTS_MAX: integer(1, 10_000).default(4),
  PRACTICE_CLIENT_CREATIONS_PER_SECOND: integer(1, 1000).default(5),
  PRACTICE_SECRET_TTL_MS: integer(0, 86_400_000).default(600_000),
  // F04: accepted in local and ci only (refinement below); an empty map when unset.
  DATABASE_CLUSTER_ENDPOINTS: clusterEndpoints.optional(),
  DATABASE_TX_MAX_WAIT_MS: integer(1, 60_000).default(2000),
  DATABASE_TX_TIMEOUT_MS: integer(1, 600_000).default(5000),
  /** How long a booking waits for a row lock: the limit on a transaction does not end that wait. */
  DATABASE_LOCK_TIMEOUT_MS: integer(1, 60_000).default(2000),
  // F04: the development store only, in local and ci; unset elsewhere until OPS01 adds the
  // provider, so every practice answers 503 there (fail closed).
  SECRET_STORE: z.enum(['dev']).optional(),
  DEV_SECRET_SEED: z.string().optional(),
  // F04: required in staging and production (refinement below).
  MARKETS: markets.default([]),
  // A01: references into the secret store. The first signing key signs and all of them verify, so
  // a key can be replaced without signing anyone out.
  AUTH_SIGNING_KEY_REFS: keyRefs.default(['dev:auth-signing-key']),
  AUTH_SECRET_REF: z.string().min(1).default('dev:auth-secret'),
  // D16: the keys of encrypted platform fields. The first encrypts and all decrypt.
  FIELD_ENCRYPTION_KEY_REFS: keyRefs.default(['dev:field-encryption-key']),
  // B01: the deployment key from which the keyed hashes of each practice are derived (ADR 0005 §4.8).
  BLIND_INDEX_KEY_REF: z.string().min(1).default('dev:blind-index-key'),
  // A02: the address every link in an e-mail is built from, never a request's Host. Required in
  // staging and production (refinement below).
  PUBLIC_WEB_URL: webOrigin.optional(),
  // A02: smtp://host:port. Unset: e-mails wait and retry instead of being lost. Everything but a local
  // catcher needs TLS in every environment (refinement below). The host is required and plain:
  // without `//` the URL has none here, while nodemailer adds the slashes and logs in unencrypted.
  SMTP_URL: z.url({ protocol: /^smtps?$/, hostname: /^[A-Za-z0-9.-]+$/ }).optional(),
  MAIL_FROM: z.string().min(1).default('MediBooker <no-reply@medibooker.invalid>'),
  // RT-91: who a real mail server may reach. Required with one in local and ci, refused in production
  // (refinement below), and the sender refuses everyone else.
  MAIL_ALLOWED_RECIPIENTS: mailAddresses.optional(),
  // A02: how often the outbox looks for due e-mails; 0 turns the timer off (tests).
  OUTBOX_POLL_SECONDS: integer(0, 3600).default(5),
  // B01: how often the relay visits every practice for the membership index; 0 turns it off (tests).
  RELAY_POLL_SECONDS: integer(0, 3600).default(900),
  // Debug switches, read by the `debug` package (Express's router, body-parser, finalhandler) and
  // by Node when a module loads, never by the API: their output goes to stderr, outside pino, with
  // request URLs and query strings. Allowed in local and ci only (refinement below); not in Env.
  DEBUG: z.string().optional(),
  NODE_DEBUG: z.string().optional(),
  NODE_DEBUG_NATIVE: z.string().optional(),
});

const DEBUG_SWITCHES = ['DEBUG', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE'] as const;

type DebugSwitch = (typeof DEBUG_SWITCHES)[number];

/** The environment without the debug switches, which only third-party code reads. */
function withoutDebugSwitches<T extends Partial<Record<DebugSwitch, string>>>(
  env: T,
): Omit<T, DebugSwitch> {
  const copy = { ...env };
  delete copy.DEBUG;
  delete copy.NODE_DEBUG;
  delete copy.NODE_DEBUG_NATIVE;
  return copy;
}

/** The keys that already have an issue: their values do not have their output types. */
function keysWithIssues(issues: readonly z.core.$ZodRawIssue[]): ReadonlySet<PropertyKey> {
  return new Set(issues.flatMap((issue) => issue.path?.slice(0, 1) ?? []));
}

const envSchema = envObject
  .superRefine(
    (env, ctx) => {
      // A rule reads only keys that parsed: a key with an issue is already reported, and its value
      // does not have its output type.
      const invalid = keysWithIssues(ctx.issues);
      const parsed = (key: keyof typeof env): boolean => !invalid.has(key);
      const reject = (key: keyof typeof env, reason: string): void => {
        ctx.addIssue({ code: 'custom', path: [key], params: { reason } });
      };
      // pino-pretty is a devDependency: a built image (NODE_ENV=production, also in staging and in
      // the compose app profile) does not contain it.
      if (
        parsed('NODE_ENV') &&
        env.NODE_ENV === 'production' &&
        parsed('LOG_PRETTY') &&
        env.LOG_PRETTY
      ) {
        reject('LOG_PRETTY', 'not_allowed_with_node_env_production');
      }
      if (!parsed('APP_ENV')) return;
      const isDeployed = env.APP_ENV === 'staging' || env.APP_ENV === 'production';
      if (isDeployed && parsed('NODE_ENV') && env.NODE_ENV !== 'production') {
        reject('NODE_ENV', 'production_required_in_staging_and_production');
      }
      if (isDeployed && parsed('TRUST_PROXY_HOPS') && env.TRUST_PROXY_HOPS === undefined) {
        reject('TRUST_PROXY_HOPS', 'required_in_staging_and_production');
      }
      if (isDeployed && parsed('LOG_LEVEL') && LEVELS_WITHOUT_ERROR_LINES.has(env.LOG_LEVEL)) {
        reject('LOG_LEVEL', 'not_allowed_in_staging_and_production');
      }
      // A limit copied from the tests would switch throttling off.
      if (
        isDeployed &&
        parsed('RATE_LIMIT_PER_MINUTE') &&
        env.RATE_LIMIT_PER_MINUTE > DEPLOYED_RATE_LIMIT_MAX
      ) {
        reject('RATE_LIMIT_PER_MINUTE', 'at_most_1000_in_staging_and_production');
      }
      // Debug output bypasses pino and the access log's allowlist (02 §8).
      for (const key of DEBUG_SWITCHES) {
        if (isDeployed && env[key] !== undefined)
          reject(key, 'not_allowed_in_staging_and_production');
      }
      // Outside local and ci every database connection verifies the server (ADR 0005 §4.9).
      if (
        isDeployed &&
        parsed('PLATFORM_DATABASE_URL') &&
        !verifiesServer(env.PLATFORM_DATABASE_URL)
      ) {
        reject('PLATFORM_DATABASE_URL', 'verify_full_required_outside_local_and_ci');
      }
      // The endpoint override and the development secret store exist for local and ci only.
      if (
        isDeployed &&
        parsed('DATABASE_CLUSTER_ENDPOINTS') &&
        env.DATABASE_CLUSTER_ENDPOINTS !== undefined
      ) {
        reject('DATABASE_CLUSTER_ENDPOINTS', 'only_in_local_and_ci');
      }
      if (parsed('SECRET_STORE') && env.SECRET_STORE === 'dev') {
        if (isDeployed) reject('SECRET_STORE', 'dev_only_in_local_and_ci');
        if (parsed('DEV_SECRET_SEED') && env.DEV_SECRET_SEED === undefined) {
          reject('DEV_SECRET_SEED', 'required_with_secret_store_dev');
        }
      }
      // A deployment serves only the markets it names (ADR 0005 §7.2).
      if (isDeployed && parsed('MARKETS') && env.MARKETS.length === 0) {
        reject('MARKETS', 'required_in_staging_and_production');
      }
      if (isDeployed && parsed('PUBLIC_WEB_URL')) {
        if (env.PUBLIC_WEB_URL === undefined) {
          reject('PUBLIC_WEB_URL', 'required_in_staging_and_production');
        } else if (!env.PUBLIC_WEB_URL.startsWith('https://')) {
          reject('PUBLIC_WEB_URL', 'https_required_in_staging_and_production');
        }
      }
      if (parsed('SMTP_URL') && env.SMTP_URL !== undefined) {
        const isCatcher = !isDeployed && isLocalCatcher(env.SMTP_URL);
        if (isDeployed && !isEncryptedSmtp(env.SMTP_URL)) {
          reject('SMTP_URL', 'tls_required_in_staging_and_production');
        } else if (!isDeployed && !isCatcher && !isEncryptedSmtp(env.SMTP_URL)) {
          reject('SMTP_URL', 'tls_required_for_a_real_mail_server');
        }
        // From a machine of the team a real server reaches only the team (RT-91).
        if (
          !isDeployed &&
          !isCatcher &&
          parsed('MAIL_ALLOWED_RECIPIENTS') &&
          env.MAIL_ALLOWED_RECIPIENTS === undefined
        ) {
          reject('MAIL_ALLOWED_RECIPIENTS', 'required_with_a_real_mail_server_in_local_and_ci');
        }
      }
      if (
        isDeployed &&
        parsed('AUTH_SIGNING_KEY_REFS') &&
        env.AUTH_SIGNING_KEY_REFS.some(isDevReference)
      ) {
        reject('AUTH_SIGNING_KEY_REFS', 'dev_reference_only_in_local_and_ci');
      }
      if (isDeployed && parsed('AUTH_SECRET_REF') && isDevReference(env.AUTH_SECRET_REF)) {
        reject('AUTH_SECRET_REF', 'dev_reference_only_in_local_and_ci');
      }
      if (
        isDeployed &&
        parsed('FIELD_ENCRYPTION_KEY_REFS') &&
        env.FIELD_ENCRYPTION_KEY_REFS.some(isDevReference)
      ) {
        reject('FIELD_ENCRYPTION_KEY_REFS', 'dev_reference_only_in_local_and_ci');
      }
      if (isDeployed && parsed('BLIND_INDEX_KEY_REF') && isDevReference(env.BLIND_INDEX_KEY_REF)) {
        reject('BLIND_INDEX_KEY_REF', 'dev_reference_only_in_local_and_ci');
      }
      if (env.APP_ENV !== 'production') return;
      if (parsed('OPENAPI_UI_ENABLED') && env.OPENAPI_UI_ENABLED) {
        reject('OPENAPI_UI_ENABLED', 'not_allowed_in_production');
      }
      // A list left over from testing would silently keep the e-mails of real people back.
      if (parsed('MAIL_ALLOWED_RECIPIENTS') && env.MAIL_ALLOWED_RECIPIENTS !== undefined) {
        reject('MAIL_ALLOWED_RECIPIENTS', 'not_allowed_in_production');
      }
      if (
        parsed('CORS_ORIGINS') &&
        env.CORS_ORIGINS.some((origin) => !origin.startsWith('https://'))
      ) {
        reject('CORS_ORIGINS', 'https_required_in_production');
      }
    },
    // Zod skips a refinement once any key has failed. These rules run anyway, so one parse names
    // every invalid key; each reads only keys that parsed.
    { when: () => true },
  )
  .transform(({ TRUST_PROXY_HOPS, DATABASE_CLUSTER_ENDPOINTS, PUBLIC_WEB_URL, ...env }) => ({
    ...withoutDebugSwitches(env),
    PUBLIC_WEB_URL: PUBLIC_WEB_URL ?? 'http://localhost:3000',
    TRUST_PROXY_HOPS: TRUST_PROXY_HOPS ?? 0,
    DATABASE_CLUSTER_ENDPOINTS:
      DATABASE_CLUSTER_ENDPOINTS ?? (new Map() as ReadonlyMap<string, ClusterEndpoint>),
  }));

/** The validated API configuration (02 §7). */
export type Env = z.output<typeof envSchema>;

/** `KEY (issue code)`; a custom issue adds its reason. Never a value or an issue message. */
function describeIssue(issue: z.core.$ZodIssue): string {
  const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '(environment)';
  const reason: unknown = issue.code === 'custom' ? issue.params?.reason : undefined;
  return typeof reason === 'string' ? `${key} (custom: ${reason})` : `${key} (${issue.code})`;
}

/**
 * Validates the environment once, at startup. An empty or blank value counts as unset (a required
 * TRUST_PROXY_HOPS must not be satisfied by ' ') and unknown keys are ignored. On failure it writes
 * one line per issue to stderr, sorted, with the key and the issue code only, and exits with code 1.
 */
export function parseEnv(source: EnvSource): Env {
  const withoutBlankValues = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const result = envSchema.safeParse(withoutBlankValues);
  if (result.success) return result.data;

  const lines = [...new Set(result.error.issues.map(describeIssue))].sort();
  process.stderr.write(
    `Invalid environment; values are not shown:\n${lines.map((line) => `  ${line}\n`).join('')}`,
  );
  return process.exit(1);
}

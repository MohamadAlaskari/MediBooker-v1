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

const corsOrigins = z.string().transform((value, ctx) => {
  const origins = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (!origins.every(isOrigin)) {
    ctx.addIssue({ code: 'custom', params: { reason: 'not_an_origin' } });
    return z.NEVER;
  }
  return origins;
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
      if (env.APP_ENV !== 'production') return;
      if (parsed('OPENAPI_UI_ENABLED') && env.OPENAPI_UI_ENABLED) {
        reject('OPENAPI_UI_ENABLED', 'not_allowed_in_production');
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
  .transform(({ TRUST_PROXY_HOPS, ...env }) => ({
    ...withoutDebugSwitches(env),
    TRUST_PROXY_HOPS: TRUST_PROXY_HOPS ?? 0,
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

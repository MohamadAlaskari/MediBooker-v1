import { z } from 'zod';

/** A practice slug as the API accepts it. */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const serverEnv = z
  .object({
    API_INTERNAL_URL: z.url(),
    PUBLIC_SITE_URL: z.url(),
    APP_ENV: z.enum(['local', 'ci', 'staging', 'production']),
    /**
     * The practice of this installation (ADR 0016): its page is the root of the domain. Blank counts
     * as unset, as compose passes it; unset, the root is a neutral page and every practice keeps its
     * own path, as in development with several demo practices.
     */
    PRACTICE_SLUG: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().regex(SLUG).optional(),
    ),
  })
  .refine(
    ({ APP_ENV, PRACTICE_SLUG }) =>
      PRACTICE_SLUG !== undefined || (APP_ENV !== 'staging' && APP_ENV !== 'production'),
    // A real installation serves exactly one practice: without it, its domain would show none.
    { path: ['PRACTICE_SLUG'] },
  );

export type ServerEnv = z.infer<typeof serverEnv>;

/**
 * The web server's environment (03 §2). A wrong value stops the start, and the error names only
 * the keys, never a value.
 */
export function parseServerEnv(
  environment: Readonly<Record<string, string | undefined>>,
): ServerEnv {
  const result = serverEnv.safeParse(environment);
  if (result.success) return result.data;
  const keys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
  throw new Error(`Invalid web server environment: ${keys.join(', ')}`);
}

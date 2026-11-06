import { z } from 'zod';

const serverEnv = z.object({
  API_INTERNAL_URL: z.url(),
  PUBLIC_SITE_URL: z.url(),
  APP_ENV: z.enum(['local', 'ci', 'staging', 'production']),
});

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

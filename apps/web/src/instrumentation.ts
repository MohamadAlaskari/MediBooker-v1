import { parseServerEnv } from './lib/server-env';

/** Runs once when the server starts: a wrong environment stops it at once (03 §2). */
export function register(): void {
  if (process.env.NEXT_RUNTIME === 'nodejs') parseServerEnv(process.env);
}

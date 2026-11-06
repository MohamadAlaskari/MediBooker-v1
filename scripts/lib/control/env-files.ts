import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Stack } from './stacks.ts';

const PROD_SECRET_KEYS = [
  'POSTGRES_PASSWORD',
  'PLATFORM_OWNER_PASSWORD',
  'PLATFORM_APP_PASSWORD',
  'PROVISIONER_PASSWORD',
  'DEV_SECRET_SEED',
] as const;

/** The content of `.env.prod`: new random values; hex, because they end up inside URLs. */
export function productionEnvFile(random: () => string): string {
  return [
    '# Written by the control menu on the first start of the production stack. Gitignored.',
    '# The database keeps the passwords of its first start: delete this file only together with',
    '# the stack ("Alles dieses Betriebs entfernen").',
    ...PROD_SECRET_KEYS.map((key) => `${key}=${random()}`),
    'OPENAPI_UI_ENABLED=false',
    '',
  ].join('\n');
}

/**
 * Makes sure the stack's environment file exists: development copies the placeholders of
 * `.env.example`, production gets its own random secrets, never shown. True when it was created.
 */
export function ensureEnvFile(stack: Stack, root: string): boolean {
  const file = path.join(root, stack.envFile);
  if (existsSync(file)) return false;
  if (stack.mode === 'dev') {
    copyFileSync(path.join(root, '.env.example'), file);
  } else {
    // Only for this user, and never over a file that appeared in the meantime.
    writeFileSync(
      file,
      productionEnvFile(() => randomBytes(24).toString('hex')),
      { mode: 0o600, flag: 'wx' },
    );
  }
  return true;
}

/** The value of a key in an environment file's text; the last assignment wins, as in compose. */
export function envValue(text: string, key: string): string | undefined {
  const values = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`${key}=`))
    .map((line) => line.slice(key.length + 1).trim());
  return values.at(-1);
}

/** Whether this stack serves the Swagger UI. */
export function isSwaggerEnabled(stack: Stack, root: string): boolean {
  if (stack.mode === 'dev') return true;
  const file = path.join(root, stack.envFile);
  return existsSync(file) && envValue(readFileSync(file, 'utf8'), 'OPENAPI_UI_ENABLED') === 'true';
}

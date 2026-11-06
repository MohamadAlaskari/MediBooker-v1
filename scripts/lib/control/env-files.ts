import { randomBytes } from 'node:crypto';
import { constants, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
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
  try {
    // Exclusive creation, not a check first: an existing file is never overwritten.
    if (stack.mode === 'dev') {
      copyFileSync(path.join(root, '.env.example'), file, constants.COPYFILE_EXCL);
    } else {
      writeFileSync(
        file,
        productionEnvFile(() => randomBytes(24).toString('hex')),
        { mode: 0o600, flag: 'wx' },
      );
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
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
  try {
    const text = readFileSync(path.join(root, stack.envFile), 'utf8');
    return envValue(text, 'OPENAPI_UI_ENABLED') === 'true';
  } catch {
    // Not written yet: the default is off.
    return false;
  }
}

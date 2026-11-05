import { existsSync } from 'node:fs';
import path from 'node:path';

/** The nearest directory at or above `startDir` that contains `pnpm-workspace.yaml`. */
export function findWorkspaceRoot(startDir: string): string | undefined {
  for (let dir = path.resolve(startDir); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    if (path.dirname(dir) === dir) return undefined;
  }
}

/**
 * Outside production, loads the workspace root's `.env` into `process.env` if it exists. Values
 * already set in the environment win. One root `.env` serves every tool of the workspace
 * (02 §3); a production image has no workspace above it and gets its values from the platform.
 * This module has no import-time side effect, so tests can import it.
 */
export function loadWorkspaceEnv(startDir: string, nodeEnv: string | undefined): void {
  if (nodeEnv === 'production') return;
  const root = findWorkspaceRoot(startDir);
  if (root === undefined) return;
  const file = path.join(root, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

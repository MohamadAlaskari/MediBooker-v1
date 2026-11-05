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
 * Outside production, loads the workspace root's `.env` into `process.env` if it exists; values
 * already set in the environment win. The one root `.env` serves the API, both Prisma configs,
 * medibooker-db, the seed and the e2e fixtures (02 §3, 07 §2). The search starts at this
 * package by default, so the workspace that holds medibooker-db is found from any working
 * directory; the migrate image has no workspace above it and gets its values from the platform.
 */
export function loadWorkspaceEnv(startDir: string = import.meta.dirname): void {
  if (process.env.NODE_ENV === 'production') return;
  const root = findWorkspaceRoot(startDir);
  if (root === undefined) return;
  const file = path.join(root, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

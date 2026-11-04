import { join } from 'node:path';

/** Builds a path inside the synthetic fixtures folder. */
export function fixturePath(...segments: readonly string[]): string {
  return join('fixtures', ...segments);
}

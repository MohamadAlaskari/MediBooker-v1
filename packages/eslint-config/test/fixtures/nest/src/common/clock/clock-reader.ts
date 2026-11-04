// Synthetic violation: without a decorator, SystemClock is used only as a type and must be
// imported with `import type`.
import { SystemClock } from './system-clock.js';

export function readClock(clock: SystemClock): Date {
  return clock.now();
}

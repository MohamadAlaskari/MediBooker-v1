// Fixture for node.json: Node built-ins resolve (types: ["node"]) and the strict flags are active.
import { createHash } from 'node:crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const syntheticSlotMinutes: readonly number[] = [15, 30];

// @ts-expect-error noUncheckedIndexedAccess: an indexed element may be undefined.
export const firstSlotMinutes: number = syntheticSlotMinutes[0];

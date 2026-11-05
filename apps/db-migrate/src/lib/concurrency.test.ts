import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency.ts';

describe('mapWithConcurrency', () => {
  it('keeps the order of the items and never exceeds the limit', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapWithConcurrency([30, 5, 20, 1, 10, 2], 2, async (ms) => {
      running += 1;
      peak = Math.max(peak, running);
      await sleep(ms);
      running -= 1;
      return ms * 2;
    });
    expect(results).toEqual([60, 10, 40, 2, 20, 4]);
    expect(peak).toBe(2);
  });

  it('handles no items and a limit above the item count', async () => {
    await expect(mapWithConcurrency([], 4, () => Promise.resolve(1))).resolves.toEqual([]);
    await expect(mapWithConcurrency([1], 4, (item) => Promise.resolve(item))).resolves.toEqual([1]);
  });
});

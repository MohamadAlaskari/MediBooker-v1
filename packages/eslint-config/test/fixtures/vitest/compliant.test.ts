// Nothing for the preset to report: a non-null assertion, a planned test (it.todo) and a test
// that skips only where a synthetic tool is missing (it.skipIf), as the gitleaks test does.
import { describe, expect, it } from 'vitest';

const syntheticSlots = new Map([['slot-a', '2026-11-02T08:30:00Z']]);
const hasSyntheticTool = process.env.SYNTHETIC_TOOL_PATH !== undefined;

describe('synthetic slots', () => {
  it('finds a synthetic slot', () => {
    expect(syntheticSlots.get('slot-a')!).toBe('2026-11-02T08:30:00Z');
  });

  it.todo('rejects a synthetic slot outside the opening hours');

  it.skipIf(!hasSyntheticTool)('runs only where the synthetic tool is installed', () => {
    expect(hasSyntheticTool).toBe(true);
  });
});

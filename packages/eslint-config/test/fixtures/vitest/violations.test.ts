// Synthetic violations: a focused test and two disabled tests, which would silently drop tests.
import { describe, expect, it } from 'vitest';

describe('synthetic booking rules', () => {
  it.only('accepts a synthetic slot', () => {
    expect(2 + 2).toBe(4);
  });

  it.skip('rejects a synthetic slot in the past', () => {
    expect(2 + 2).toBe(4);
  });
});

describe.skip('synthetic reminders', () => {
  it('plans a synthetic reminder', () => {
    expect(2 + 2).toBe(4);
  });
});

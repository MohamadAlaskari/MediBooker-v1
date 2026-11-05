import { describe, expect, it } from 'vitest';

describe('the test environment', () => {
  it('06 §3 runs every API test in Pacific/Chatham', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Pacific/Chatham');
    // Chatham daylight time on that date: UTC+13:45.
    expect(new Date('2026-11-16T05:00:00Z').getTimezoneOffset()).toBe(-825);
  });
});

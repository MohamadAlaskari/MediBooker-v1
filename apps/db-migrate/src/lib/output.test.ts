import { describe, expect, it } from 'vitest';
import { jsonLineSink, practiceLine, silentOutput } from './output.ts';

describe('practiceLine', () => {
  it('has exactly practiceId, from, to, durationMs and errorCode, in this order', () => {
    const line = practiceLine(
      '00000000-0000-4000-8000-000000000001',
      '20261105140000_practice_identity',
      null,
      performance.now(),
      'MIGRATION_FAILED',
    );
    expect(Object.keys(line)).toEqual(['practiceId', 'from', 'to', 'durationMs', 'errorCode']);
    expect(line.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(line.durationMs)).toBe(true);
  });
});

describe('jsonLineSink', () => {
  it('writes one JSON document per line', () => {
    const written: string[] = [];
    const sink = jsonLineSink((text) => {
      written.push(text);
    });
    sink.write({ practiceId: 'p', from: null, to: 'v', durationMs: 3, errorCode: null });
    sink.write({ command: 'verify', practices: 1, failed: 0, durationMs: 4, errorCode: null });
    expect(written).toEqual([
      '{"practiceId":"p","from":null,"to":"v","durationMs":3,"errorCode":null}\n',
      '{"command":"verify","practices":1,"failed":0,"durationMs":4,"errorCode":null}\n',
    ]);
  });

  it('has a silent variant for the test helpers', () => {
    expect(() => {
      silentOutput.write({ command: 'x', practices: 0, failed: 0, durationMs: 0, errorCode: null });
    }).not.toThrow();
  });
});

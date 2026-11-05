import type { PinoLogger } from 'nestjs-pino';
import { type Mock, vi } from 'vitest';

/** One call of a logging method: its fields and its message, as the code passed them. */
export interface LoggedCall {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly fields: unknown;
  readonly message: unknown;
}

export interface FakePinoLogger {
  readonly logger: PinoLogger;
  /** Every call of debug, info, warn and error, in order. */
  readonly calls: LoggedCall[];
  readonly setContext: Mock;
  /** nestjs-pino's binding of fields to the rest of a request. */
  readonly assign: Mock;
}

/**
 * A stand-in for nestjs-pino's PinoLogger in unit tests of providers built without Nest: it
 * records every call, so a test can assert that only reviewed fields and constant messages are
 * logged. The field allowlist itself is tested with the real logger (pino-options.spec.ts).
 */
export function fakePinoLogger(): FakePinoLogger {
  const calls: LoggedCall[] = [];
  const record =
    (level: LoggedCall['level']) =>
    (fields: unknown, message?: unknown): void => {
      calls.push({ level, fields, message });
    };
  const setContext = vi.fn();
  const assign = vi.fn();
  const logger = {
    setContext,
    assign,
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  };
  return { logger: logger as unknown as PinoLogger, calls, setContext, assign };
}

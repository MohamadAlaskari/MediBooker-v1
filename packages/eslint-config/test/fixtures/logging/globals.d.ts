// The values that the typed rule tests log (test/rules/typed-rule-tester.ts), declared once so a
// case is the call under test only.
import type { PinoLogger, RunInContextOptions } from 'nestjs-pino';
import type { Logger } from 'pino';

declare global {
  /** An Express request with pino-http's request logger. */
  const req: { log: Logger };
  /** pino's logger. */
  const logger: Logger;
  /** nestjs-pino's injectable logger. */
  const pinoLogger: PinoLogger;
  const err: Error;
  const email: string;
  const message: string;
  const id: string;
  const practiceId: string;
  const x: number;
  const value: unknown;
  /** A domain object whose methods share a logger's names but take no message or bindings. */
  const booking: {
    error(code: string): void;
    child(name: string): object;
    assign(fields: object): void;
  };
  const target: object;
  const source: object;
  /** A helper with the name of nestjs-pino's method. */
  function runInContext<T>(fn: () => T, options?: RunInContextOptions): T;
  class Probe {}
}

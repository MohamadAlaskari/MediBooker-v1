import type { ErrorCode } from './errors.ts';

/**
 * medibooker-db prints JSON lines only (02 §6): one per practice and one summary per command.
 * They carry ids, schema versions, durations, counts and error codes, never a host, user,
 * connection string, secret reference, password or the Prisma CLI's own output.
 */

/** One practice a command worked on. */
export interface PracticeLine {
  readonly practiceId: string;
  /** Schema version before the command (migrate, provision), or the recorded one (verify). */
  readonly from: string | null;
  /** Schema version after the command; null when unknown. */
  readonly to: string | null;
  readonly durationMs: number;
  readonly errorCode: ErrorCode | null;
}

/** The last line of every command. */
export interface SummaryLine {
  /** For example `migrate practices`; null when the command line could not be parsed. */
  readonly command: string | null;
  /** Practices the command worked on, and how many of them failed. */
  readonly practices: number;
  readonly failed: number;
  readonly durationMs: number;
  /** A failure of the command itself, for example an unreachable platform database. */
  readonly errorCode: ErrorCode | null;
  /** `migrate platform`: the platform schema version before and after. */
  readonly from?: string | null;
  readonly to?: string | null;
  /** `practice create`: the practice it created or completed, and its address name. */
  readonly practiceId?: string;
  readonly slug?: string;
  /** ENVIRONMENT_INVALID: the names of the invalid variables, never their values. */
  readonly invalidKeys?: readonly string[];
  /** INVALID_ARGUMENTS: how to call the command. */
  readonly usage?: string;
}

export type OutputLine = PracticeLine | SummaryLine;

export interface OutputSink {
  write(line: OutputLine): void;
}

/** Discards everything: the test helpers report through their return values. */
export const silentOutput: OutputSink = { write: () => undefined };

/** Writes each line as JSON with a trailing newline, for example to process.stdout. */
export function jsonLineSink(write: (text: string) => void): OutputSink {
  return {
    write: (line) => {
      write(`${JSON.stringify(line)}\n`);
    },
  };
}

/** Milliseconds since `start` (a `performance.now()` value), rounded. */
export function elapsedMs(start: number): number {
  return Math.round(performance.now() - start);
}

export function practiceLine(
  practiceId: string,
  from: string | null,
  to: string | null,
  start: number,
  errorCode: ErrorCode | null,
): PracticeLine {
  return { practiceId, from, to, durationMs: elapsedMs(start), errorCode };
}

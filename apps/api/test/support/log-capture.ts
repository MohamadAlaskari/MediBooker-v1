import type { DestinationStream, Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { vi } from 'vitest';
import { pinoOptions } from '../../src/common/logging/pino-options.js';
import type { Env } from '../../src/config/env.schema.js';

/** One parsed JSON log line. */
export type LogLine = Readonly<Record<string, unknown>>;

/** A log destination that keeps every line for assertions. */
export interface LogCapture extends DestinationStream {
  /** Everything written so far, unparsed: assert on it for markers that must never appear. */
  text(): string;
  lines(): LogLine[];
  /** The access-log line of the request with this id, once pino-http has written it. */
  waitForAccessLine(requestId: string): Promise<LogLine>;
}

/** The default destination of test apps: drops every line. */
export const DISCARD_LOGS: DestinationStream = {
  write: () => undefined,
};

function requestIdOfLine(line: LogLine): unknown {
  const req = line.req;
  return typeof req === 'object' && req !== null && 'id' in req ? req.id : undefined;
}

export function captureLogs(): LogCapture {
  const chunks: string[] = [];
  const lines = (): LogLine[] =>
    chunks
      .join('')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as LogLine);
  const accessLineOf = (requestId: string): LogLine | undefined =>
    lines().find(
      (line) => typeof line.responseTime === 'number' && requestIdOfLine(line) === requestId,
    );
  return {
    write: (chunk: string) => {
      chunks.push(chunk);
    },
    text: () => chunks.join(''),
    lines,
    // pino-http writes the access line when the response has finished, which can be after the
    // client has read the response.
    waitForAccessLine: (requestId) =>
      vi.waitFor(() => {
        const line = accessLineOf(requestId);
        if (line === undefined) throw new Error('access log line not written yet');
        return line;
      }),
  };
}

/**
 * The root logger that nestjs-pino builds from `pinoOptions(env, destination)`
 * (`pinoHttp(...params)`), writing into a capture. For unit tests of the log options without an
 * app; each call builds a new logger.
 */
export function createCapturedLogger(env: Env): Pick<LogCapture, 'lines' | 'text'> & {
  logger: Logger;
} {
  const capture = captureLogs();
  const { pinoHttp: params } = pinoOptions(env, capture);
  if (!Array.isArray(params)) throw new Error('options with a destination expected');
  return {
    logger: pinoHttp(...params).logger,
    lines: () => capture.lines(),
    text: () => capture.text(),
  };
}

import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { childEnv } from '../../../test/support/child-env.js';
import { createCapturedLogger, type LogLine } from '../../../test/support/log-capture.js';
import { TEST_ENV } from '../../../test/support/test-env.js';
import { parseEnv } from '../../config/env.schema.js';
import { registerProcessHandlers } from './process-handlers.js';

const env = parseEnv(TEST_ENV);

/** A message with the synthetic markers of 02 §8, as a database or library error can carry. */
const LEAKY_MESSAGE = 'duplicate key for sara@example.test (secret-value)';
const MARKERS = /secret-value|sara@example\.test|duplicate key/;

const SUPPORT_DIR = path.resolve(import.meta.dirname, '../../../test/support');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('registerProcessHandlers', () => {
  it.each([
    ['uncaughtException', 'uncaught exception'],
    ['unhandledRejection', 'unhandled rejection'],
  ])(
    'logs %s once at fatal with a constant message and the serialized error, then exits with 1',
    (event, message) => {
      const { logger, lines, text } = createCapturedLogger(env);
      const exit = vi.fn<(code: number) => void>();
      const events = new EventEmitter();
      registerProcessHandlers(logger, exit, events);

      events.emit(event, Object.assign(new TypeError(LEAKY_MESSAGE), { detail: LEAKY_MESSAGE }));

      expect(lines()).toEqual([
        expect.objectContaining({ level: 60, msg: message, err: expect.anything() as unknown }),
      ]);
      expect(lines()[0]?.err).toEqual({
        type: 'TypeError',
        stack: expect.stringMatching(/^TypeError\n\s+at /) as unknown,
      });
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(text()).not.toMatch(MARKERS);
    },
  );

  it('logs a rejection reason that is not an error by its type', () => {
    const { logger, lines, text } = createCapturedLogger(env);
    const exit = vi.fn<(code: number) => void>();
    const events = new EventEmitter();
    registerProcessHandlers(logger, exit, events);

    events.emit('unhandledRejection', LEAKY_MESSAGE);

    expect(lines()).toEqual([
      expect.objectContaining({ msg: 'unhandled rejection', err: { type: 'string' } }),
    ]);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(text()).not.toMatch(MARKERS);
  });

  it('exits with 1 also when logging fails, and throws nothing', () => {
    const exit = vi.fn<(code: number) => void>();
    const events = new EventEmitter();
    const failingLogger = {
      fatal: (): never => {
        throw new Error('destination closed');
      },
    };
    registerProcessHandlers(failingLogger, exit, events);

    expect(() => events.emit('uncaughtException', new Error(LEAKY_MESSAGE))).not.toThrow();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('registers both handlers on the process by default', () => {
    const on = vi.spyOn(process, 'on').mockReturnValue(process);
    registerProcessHandlers(createCapturedLogger(env).logger, vi.fn<(code: number) => void>());
    expect(on.mock.calls.map(([event]) => event)).toEqual([
      'uncaughtException',
      'unhandledRejection',
    ]);
  });
});

describe('a process that fails outside every handler', () => {
  /** Runs test/support/fatal-process.ts, compiled by test/support/ts-source-hooks.ts, and returns its output. */
  function runFatalProcess(...args: string[]): {
    status: number | null;
    stdout: string;
    stderr: string;
  } {
    const hooks = pathToFileURL(path.join(SUPPORT_DIR, 'ts-source-hooks.ts')).href;
    const { status, stdout, stderr } = spawnSync(
      process.execPath,
      ['--import', hooks, path.join(SUPPORT_DIR, 'fatal-process.ts'), ...args],
      { encoding: 'utf8', env: childEnv(), timeout: 30_000 },
    );
    return { status, stdout, stderr };
  }

  it.each([
    ['uncaught', 'uncaught exception'],
    ['rejection', 'unhandled rejection'],
  ])(
    'with the handlers (%s): one pino line on stdout, nothing on stderr, exit code 1',
    (failure, message) => {
      const { status, stdout, stderr } = runFatalProcess(failure);
      expect(stderr).toBe('');
      expect(status).toBe(1);
      const lines = stdout
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as LogLine);
      expect(lines).toEqual([
        expect.objectContaining({ level: 60, msg: message, err: expect.anything() as unknown }),
      ]);
      expect(lines[0]?.err).toMatchObject({ type: 'Error' });
      expect(stdout).not.toMatch(MARKERS);
    },
    30_000,
  );

  it('control: without the handlers, Node writes the message and the detail to stderr', () => {
    const { status, stdout, stderr } = runFatalProcess('uncaught', '--without-handlers');
    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/Key \(email\)=\(sara@example\.test\)/);
  }, 30_000);
});

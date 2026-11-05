import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { childEnv } from '../test/support/child-env.js';
import type { LogLine } from '../test/support/log-capture.js';

const API_DIR = path.resolve(import.meta.dirname, '..');
const HOOKS = pathToFileURL(path.join(API_DIR, 'test/support/ts-source-hooks.ts')).href;

/**
 * The environment of a deployed API on `port`. With NODE_ENV=production the run reads no `.env`
 * (`loadWorkspaceEnv`), so the test does not depend on the developer's file; every API variable is
 * set, a blank one counting as unset (02 §7).
 */
function deployedEnv(port: number): NodeJS.ProcessEnv {
  return childEnv({
    NODE_ENV: 'production',
    APP_ENV: 'production',
    PORT: String(port),
    HOST: '127.0.0.1',
    LOG_LEVEL: 'info',
    LOG_PRETTY: '',
    CORS_ORIGINS: '',
    TRUST_PROXY_HOPS: '1',
    OPENAPI_UI_ENABLED: '',
    RATE_LIMIT_PER_MINUTE: '120',
  });
}

/**
 * Every message a production boot on a taken port may log (02 §8). Project code logs constants;
 * Nest builds its boot lines from code metadata (module names, controller paths, route patterns)
 * and its listen error from `error.toString()`, which holds the bind address only. A line in any
 * other form fails the test, so a framework line with new runtime text shows up here.
 */
const EXPECTED_MESSAGES: readonly RegExp[] = [
  /^Starting Nest application\.\.\.$/,
  /^[A-Z][A-Za-z0-9]* dependencies initialized$/,
  /^[A-Z][A-Za-z0-9]* \{\/[\w/:-]*\} \(version: [\w,]+\):$/,
  /^Mapped \{\/[\w/:-]*, [A-Z]+\} \(version: [\w,]+\) route$/,
  /^Nest application successfully started$/,
  /^Error: listen EADDRINUSE: address already in use 127\.0\.0\.1:\d+$/,
  /^uncaught exception$/,
];

/** Runs `src/main.ts` as the container would, compiled by SWC, and returns its output. */
function runMain(port: number): { status: number | null; lines: LogLine[]; stderr: string } {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    ['--import', HOOKS, path.join(API_DIR, 'src/main.ts')],
    { cwd: API_DIR, encoding: 'utf8', env: deployedEnv(port), timeout: 45_000 },
  );
  const lines = stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as LogLine);
  return { status, lines, stderr };
}

describe('main.ts, the entry point (02 §3, §8)', () => {
  let occupied: Server;
  let port: number;

  beforeAll(async () => {
    occupied = createServer();
    await new Promise<void>((resolve) => {
      occupied.listen(0, '127.0.0.1', resolve);
    });
    const address = occupied.address();
    if (address === null || typeof address === 'string') throw new Error('no TCP address');
    port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      occupied.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
  });

  it('logs a taken port through pino before it exits with 1: the handlers are registered before listen', () => {
    const { status, lines, stderr } = runMain(port);

    expect(stderr).toBe('');
    expect(status).toBe(1);
    // Positive control: the application was built and initialised through main.ts.
    expect(lines).toContainEqual(
      expect.objectContaining({ level: 30, msg: 'Nest application successfully started' }),
    );
    expect(lines.filter((line) => Number(line.level) >= 50)).toEqual([
      expect.objectContaining({
        level: 50,
        context: 'NestApplication',
        msg: `Error: listen EADDRINUSE: address already in use 127.0.0.1:${String(port)}`,
      }),
      expect.objectContaining({
        level: 60,
        msg: 'uncaught exception',
        err: expect.objectContaining({ type: 'Error', code: 'EADDRINUSE' }) as unknown,
      }),
    ]);
    expect(lines.at(-1)).toMatchObject({ level: 60 });
    const unexpected = lines.filter(
      ({ msg }) => typeof msg !== 'string' || !EXPECTED_MESSAGES.some((form) => form.test(msg)),
    );
    expect(unexpected).toEqual([]);
  }, 60_000);
});

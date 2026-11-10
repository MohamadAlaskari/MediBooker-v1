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
 * (`loadWorkspaceEnv`), so the test does not depend on the developer's file; every API variable
 * of F03 is set, a blank one counting as unset (02 §7). The platform URL verifies TLS as
 * production requires; this run never connects, because `listen` fails first.
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
    PLATFORM_DATABASE_URL:
      'postgresql://platform_app:pw@db.internal.test:5432/medibooker_platform?sslmode=verify-full&sslrootcert=/run/secrets/ca.pem',
    MARKETS: 'SA',
    PUBLIC_WEB_URL: 'https://web.example.test',
    PRACTICE_SLUG: 'al-noor',
    AUTH_SIGNING_KEY_REFS: 'hosted:auth-signing-key',
    AUTH_SECRET_REF: 'hosted:auth-secret',
    FIELD_ENCRYPTION_KEY_REFS: 'hosted:field-encryption-key',
    BLIND_INDEX_KEY_REF: 'hosted:blind-index-key',
    SECRET_STORE: '',
    DEV_SECRET_SEED: '',
    DATABASE_CLUSTER_ENDPOINTS: '',
  });
}

/** Synthetic connection details of a refused platform database, which no log line may show. */
const REFUSED_USER = 'boot-user';
const REFUSED_PASSWORD = 'boot-pw';
const REFUSED_DATABASE = 'boot-db';

/**
 * A built image run as in CI (NODE_ENV=production, APP_ENV=ci, so no `.env` is read and no TLS is
 * required) on a free `port`, whose platform database refuses every connection at `databasePort`.
 */
function refusedDatabaseEnv(port: number, databasePort: number): NodeJS.ProcessEnv {
  return childEnv({
    ...deployedEnv(port),
    APP_ENV: 'ci',
    TRUST_PROXY_HOPS: '',
    MARKETS: '',
    PLATFORM_DATABASE_URL: `postgresql://${REFUSED_USER}:${REFUSED_PASSWORD}@127.0.0.1:${String(databasePort)}/${REFUSED_DATABASE}`,
  });
}

/**
 * Every message a production boot may log (02 §8). Project code logs constants; Nest builds its
 * boot lines from code metadata (module names, controller paths, route patterns) and its listen
 * error from `error.toString()`, which holds the bind address only. A line in any other form fails
 * the test, so a framework line with new runtime text shows up here.
 */
const EXPECTED_MESSAGES: readonly RegExp[] = [
  /^Starting Nest application\.\.\.$/,
  /^[A-Z][A-Za-z0-9]* dependencies initialized$/,
  /^[A-Z][A-Za-z0-9]* \{\/[\w/:-]*\} \(version: [\w,]+\):$/,
  /^Mapped \{\/[\w/:-]*, [A-Z]+\} \(version: [\w,]+\) route$/,
  /^Nest application successfully started$/,
  /^Error: listen EADDRINUSE: address already in use 127\.0\.0\.1:\d+$/,
  /^platform database error$/,
  /^uncaught exception$/,
];

/** Runs `src/main.ts` as the container would, compiled by SWC, and returns its output. */
function runMain(env: NodeJS.ProcessEnv): {
  status: number | null;
  stdout: string;
  lines: LogLine[];
  stderr: string;
} {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    ['--import', HOOKS, path.join(API_DIR, 'src/main.ts')],
    { cwd: API_DIR, encoding: 'utf8', env, timeout: 45_000 },
  );
  const lines = stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as LogLine);
  return { status, stdout, lines, stderr };
}

function unexpectedMessagesOf(lines: LogLine[]): LogLine[] {
  return lines.filter(
    ({ msg }) => typeof msg !== 'string' || !EXPECTED_MESSAGES.some((form) => form.test(msg)),
  );
}

async function listening(): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP address');
  return address.port;
}

async function closed(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

/** A port that nothing listens on: it was free a moment ago. */
async function freePort(): Promise<number> {
  const server = await listening();
  const port = portOf(server);
  await closed(server);
  return port;
}

describe('main.ts, the entry point (02 §3, §8)', () => {
  let occupied: Server;

  beforeAll(async () => {
    occupied = await listening();
  });

  afterAll(async () => {
    await closed(occupied);
  });

  it('logs a taken port through pino before it exits with 1: the handlers are registered before listen', () => {
    const port = portOf(occupied);
    const { status, lines, stderr } = runMain(deployedEnv(port));

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
    expect(unexpectedMessagesOf(lines)).toEqual([]);
  }, 60_000);

  it('logs a refused platform database after listen as one fatal line without connection details, and exits with 1', async () => {
    const databasePort = await freePort();
    const { status, stdout, lines, stderr } = runMain(
      refusedDatabaseEnv(await freePort(), databasePort),
    );

    expect(stderr).toBe('');
    expect(status).toBe(1);
    // Positive control: the check ran after listen, on a started application.
    expect(lines).toContainEqual(
      expect.objectContaining({ level: 30, msg: 'Nest application successfully started' }),
    );
    expect(lines.filter((line) => Number(line.level) >= 60)).toEqual([
      expect.objectContaining({
        msg: 'uncaught exception',
        err: expect.objectContaining({
          type: 'PrismaClientKnownRequestError',
          prismaCode: 'P2010',
        }) as unknown,
      }),
    ]);
    expect(lines.at(-1)).toMatchObject({ level: 60 });
    expect(unexpectedMessagesOf(lines)).toEqual([]);
    for (const detail of [
      REFUSED_USER,
      REFUSED_PASSWORD,
      REFUSED_DATABASE,
      `:${String(databasePort)}`,
    ]) {
      expect(stdout).not.toContain(detail);
    }
  }, 60_000);
});

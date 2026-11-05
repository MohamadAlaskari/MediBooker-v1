import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * The Prisma CLI's JavaScript entry. It runs as `process.execPath <entry>`: Node refuses to spawn
 * a `.cmd` shim without a shell, and a shell breaks on the spaces of the repository path (01 §2).
 */
export const PRISMA_CLI = createRequire(import.meta.url).resolve('prisma/build/index.js');

/** How long a timed-out Prisma process may take to exit after its backend was terminated. */
const EXIT_GRACE_MS = 10_000;

/** Captured output above this size is cut: only error codes are read from it. */
const MAX_OUTPUT_CHARS = 1_000_000;

/** Variables that make the CLI print its configuration, the datasource URL included. */
const DEBUG_VARIABLES = ['DEBUG', 'NODE_DEBUG', 'RUST_LOG', 'RUST_BACKTRACE'];

export interface PrismaRunOptions {
  /** CLI arguments after the entry, for example ['migrate', 'deploy', '--config', '…']. */
  readonly args: readonly string[];
  /** PRISMA_ROOT: the configs resolve their schema and migration paths from here. */
  readonly cwd: string;
  /** Added to the environment, for example { PRACTICE_MIGRATION_URL: '…' }. */
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  /** Runs once when the timeout fires, before the process gets the grace period to exit. */
  readonly onTimeout?: () => Promise<void>;
}

export interface PrismaRun {
  /** null when the process did not start or was killed. */
  readonly exitCode: number | null;
  /** stdout and stderr together. Read for error codes only, never printed or logged (02 §6). */
  readonly output: string;
  readonly timedOut: boolean;
}

function childEnvironment(extra: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(([name]) => !DEBUG_VARIABLES.includes(name));
  // No update check against prisma.io from a migration run.
  return { ...Object.fromEntries(inherited), ...extra, CHECKPOINT_DISABLE: '1' };
}

/** Runs the Prisma CLI with captured output and a timeout. Never rejects. */
export function runPrisma(options: PrismaRunOptions): Promise<PrismaRun> {
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let settled = false;
    const child = spawn(process.execPath, [PRISMA_CLI, ...options.args], {
      cwd: options.cwd,
      env: childEnvironment(options.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const capture = (chunk: Buffer): void => {
      if (output.length < MAX_OUTPUT_CHARS) output += chunk.toString('utf8');
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);

    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      void (options.onTimeout?.() ?? Promise.resolve())
        .catch(() => undefined)
        .finally(() => {
          if (!settled) killTimer = setTimeout(() => child.kill('SIGKILL'), EXIT_GRACE_MS);
        });
    }, options.timeoutMs);

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ exitCode, output, timedOut });
    };
    child.on('error', () => {
      finish(null);
    });
    child.on('close', (code) => {
      finish(code);
    });
  });
}

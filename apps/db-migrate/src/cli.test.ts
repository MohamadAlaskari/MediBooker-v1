import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { USAGE } from './lib/argv.ts';

const CLI = fileURLToPath(new URL('cli.ts', import.meta.url));

/**
 * Runs the CLI with Node's type stripping and an explicit environment. NODE_ENV=production keeps
 * a developer's root .env out, and no case reaches a database.
 */
function runCli(
  args: readonly string[],
  env: Record<string, string> = {},
): { status: number | null; lines: Record<string, unknown>[]; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      SYSTEMROOT: process.env.SYSTEMROOT ?? '',
      NODE_ENV: 'production',
      ...env,
    },
  });
  const lines = result.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { status: result.status, lines, stderr: result.stderr };
}

describe('medibooker-db', () => {
  it('exits with 2 and one JSON line for a wrong command line', () => {
    const { status, lines, stderr } = runCli(['migrate', 'everything']);
    expect(status).toBe(2);
    expect(lines).toEqual([
      {
        command: null,
        practices: 0,
        failed: 0,
        durationMs: 0,
        errorCode: 'INVALID_ARGUMENTS',
        usage: USAGE,
      },
    ]);
    expect(stderr).toBe('');
  });

  it('exits with 1 and names invalid variables, never their values', () => {
    const { status, lines, stderr } = runCli(['migrate', 'all'], {
      APP_ENV: 'local',
      PLATFORM_MIGRATION_URL: 'mysql://platform_owner:example-secret@127.0.0.1/x',
      MIGRATION_CONCURRENCY: '0x4',
    });
    expect(status).toBe(1);
    expect(lines).toEqual([
      {
        command: 'migrate all',
        practices: 0,
        failed: 0,
        durationMs: 0,
        errorCode: 'ENVIRONMENT_INVALID',
        invalidKeys: ['PLATFORM_MIGRATION_URL', 'MIGRATION_CONCURRENCY'],
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain('example-secret');
    expect(stderr).toBe('');
  });

  it('refuses reset-local outside local and ci', () => {
    const { status, lines } = runCli(['reset-local'], {
      APP_ENV: 'staging',
      PLATFORM_MIGRATION_URL: 'postgresql://platform_owner@db.example.test/medibooker_platform',
    });
    expect(status).toBe(1);
    expect(lines).toMatchObject([{ command: 'reset-local', errorCode: 'LOCAL_ONLY' }]);
  });

  it('refuses every command outside local and ci until OPS01 brings the operator identity', () => {
    const { status, lines } = runCli(['migrate', 'platform'], {
      APP_ENV: 'production',
      PLATFORM_MIGRATION_URL: 'postgresql://platform_owner@db.example.test/medibooker_platform',
    });
    expect(status).toBe(1);
    expect(lines).toMatchObject([
      { command: 'migrate platform', errorCode: 'OPERATOR_IDENTITY_UNAVAILABLE' },
    ]);
  });
});

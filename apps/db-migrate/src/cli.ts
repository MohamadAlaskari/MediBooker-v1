#!/usr/bin/env node
/**
 * medibooker-db: the lifecycle CLI of the platform and practice databases (02 §6). It parses the
 * command line and the environment (outside production also the workspace root's .env) and
 * prints JSON lines only. Exit code 0 ok, 1 when the command or any practice failed, 2 when
 * verify finds drift or a wrong ACL and for a wrong command line.
 * Usage: node apps/db-migrate/src/cli.ts <command> (Node's type stripping, no build).
 */
import { migrate } from './commands/migrate.ts';
import { practiceCreate } from './commands/practice-create.ts';
import { provision } from './commands/provision.ts';
import { reconcileRoles } from './commands/roles-reconcile.ts';
import { resetLocal } from './commands/reset-local.ts';
import { verify } from './commands/verify.ts';
import { isLocalOrCi } from './lib/app-env.ts';
import { commandName, parseCommandLine, USAGE } from './lib/argv.ts';
import { localActor, type ExitCode } from './lib/command.ts';
import { parseToolEnvironment } from './lib/environment.ts';
import { toErrorCode, type ErrorCode } from './lib/errors.ts';
import { jsonLineSink } from './lib/output.ts';
import { createDevSecretStore } from './lib/secret-store.ts';
import { loadWorkspaceEnv } from './lib/workspace-env.ts';

const output = jsonLineSink((text) => {
  process.stdout.write(text);
});

function fail(command: string | null, errorCode: ErrorCode, invalidKeys?: readonly string[]): 1 {
  output.write({
    command,
    practices: 0,
    failed: 0,
    durationMs: 0,
    errorCode,
    ...(invalidKeys === undefined ? {} : { invalidKeys }),
  });
  return 1;
}

async function main(args: readonly string[]): Promise<ExitCode> {
  const command = parseCommandLine(args);
  if (command === undefined) {
    output.write({
      command: null,
      practices: 0,
      failed: 0,
      durationMs: 0,
      errorCode: 'INVALID_ARGUMENTS',
      usage: USAGE,
    });
    return 2;
  }
  const name = commandName(command);
  loadWorkspaceEnv();
  const parsed = parseToolEnvironment(process.env);
  if (!parsed.ok) return fail(name, 'ENVIRONMENT_INVALID', parsed.invalidKeys);
  const env = parsed.value;
  if (env.platformUrl === undefined) {
    return fail(name, 'ENVIRONMENT_INVALID', ['PLATFORM_MIGRATION_URL']);
  }
  if (command.kind === 'reset-local' && !isLocalOrCi(env.appEnv)) return fail(name, 'LOCAL_ONLY');
  // The operator principal of staging and production comes from the task's identity (OPS01).
  if (!isLocalOrCi(env.appEnv)) return fail(name, 'OPERATOR_IDENTITY_UNAVAILABLE');

  const base = {
    appEnv: env.appEnv,
    platformUrl: env.platformUrl,
    actor: localActor(),
    output,
    secretStore:
      env.secretStore === 'dev'
        ? createDevSecretStore({
            appEnv: env.appEnv,
            seed: env.devSecretSeed,
            environment: process.env,
          })
        : undefined,
    prismaRoot: env.prismaRoot,
    clusterEndpoints: env.clusterEndpoints,
  };
  switch (command.kind) {
    case 'migrate':
      return migrate({
        ...base,
        target: command.target,
        practiceId: command.practiceId,
        concurrency: env.migrationConcurrency,
        timeoutMs: env.migrationTimeoutMs,
        lockRetries: env.migrationLockRetries,
      });
    case 'provision': {
      const result = await provision({
        ...base,
        practiceId: command.practiceId,
        market: command.market,
        clusterId: command.clusterId,
        timeZone: command.timeZone,
        defaultLocale: command.defaultLocale,
        provisionerUrl: env.provisionerUrl,
        markets: env.markets,
        connectionLimits: env.connectionLimits,
        migrationTimeoutMs: env.migrationTimeoutMs,
        migrationLockRetries: env.migrationLockRetries,
      });
      return result.exitCode;
    }
    case 'practice-create': {
      const result = await practiceCreate({
        ...base,
        slug: command.slug,
        names: command.names,
        market: command.market,
        clusterId: command.clusterId,
        timeZone: command.timeZone,
        defaultLocale: command.defaultLocale,
        provisionerUrl: env.provisionerUrl,
        markets: env.markets,
        connectionLimits: env.connectionLimits,
        migrationTimeoutMs: env.migrationTimeoutMs,
        migrationLockRetries: env.migrationLockRetries,
      });
      return result.exitCode;
    }
    case 'verify':
      return verify({
        ...base,
        practiceId: command.practiceId,
        concurrency: env.migrationConcurrency,
        timeoutMs: env.migrationTimeoutMs,
      });
    case 'roles-reconcile':
      return reconcileRoles({
        ...base,
        practiceId: command.practiceId,
        connectionLimits: env.connectionLimits,
      });
    case 'reset-local':
      if (env.adminUrl === undefined) {
        return fail(name, 'ENVIRONMENT_INVALID', ['DATABASE_ADMIN_URL']);
      }
      return resetLocal({
        ...base,
        adminUrl: env.adminUrl,
        migrationTimeoutMs: env.migrationTimeoutMs,
      });
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  // Only the code, never the error itself: its message could name a host or a role.
  process.exitCode = fail(null, toErrorCode(error));
}

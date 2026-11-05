import { userInfo } from 'node:os';
import type { Client } from 'pg';
import type { AppEnv } from './app-env.ts';
import { auditFinished, auditStarted, type AuditScope } from './audit.ts';
import type { ClusterEndpoints } from './cluster.ts';
import { connect, urlConnectionConfig } from './database.ts';
import { toErrorCode, ToolError, type ErrorCode } from './errors.ts';
import type { OutputSink } from './output.ts';
import type { SecretStore } from './secret-store.ts';

/** 0 ok; 1 when the command or any practice failed; 2 for drift or a wrong ACL and for usage. */
export type ExitCode = 0 | 1 | 2;

/** What every command needs; each command adds its own options (02 §6). */
export interface CommandOptions {
  readonly appEnv: AppEnv;
  /** PLATFORM_MIGRATION_URL: the registry and the audit log, as platform_owner. */
  readonly platformUrl: string;
  /** The operator principal of the audit rows; locally `local:<OS user>`. */
  readonly actor: string;
  readonly output: OutputSink;
}

/** Options of the commands that reach practice databases. */
export interface PracticeCommandOptions extends CommandOptions {
  /** Absent when SECRET_STORE is unset: such commands then fail with SECRET_STORE_UNAVAILABLE. */
  readonly secretStore: SecretStore | undefined;
  /** PRISMA_ROOT: the API's schemas, migrations and Prisma configs. */
  readonly prismaRoot: string;
  /** DATABASE_CLUSTER_ENDPOINTS (local and ci). */
  readonly clusterEndpoints: ClusterEndpoints;
}

/** The actor of local and CI runs; OPS01 takes it from the task's cloud identity instead. */
export function localActor(): string {
  try {
    return `local:${userInfo().username}`;
  } catch {
    // A container user without a passwd entry.
    return 'local:unknown';
  }
}

export function requireSecretStore(store: SecretStore | undefined): SecretStore {
  if (store === undefined) throw new ToolError('SECRET_STORE_UNAVAILABLE');
  return store;
}

/**
 * Runs a command between its two audit rows (ADR 0005 §5.2) on one platform connection. A command
 * whose STARTED row cannot be written does not run; a failure is returned as its code, never
 * thrown, and a missing SUCCEEDED row turns a success into AUDIT_WRITE_FAILED.
 */
export async function runAudited(
  options: CommandOptions,
  scope: Omit<AuditScope, 'actor'>,
  work: (platform: Client) => Promise<ErrorCode | null>,
  auditOptions: { readonly allowMissingTable?: boolean } = {},
): Promise<ErrorCode | null> {
  const fullScope: AuditScope = { ...scope, actor: options.actor };
  let platform: Client;
  try {
    platform = await connect(urlConnectionConfig(options.platformUrl));
  } catch (error) {
    return toErrorCode(error);
  }
  try {
    await auditStarted(platform, fullScope, auditOptions);
    const errorCode = await work(platform).catch(toErrorCode);
    const auditError = await auditFinished(platform, fullScope, errorCode);
    return errorCode ?? auditError;
  } catch (error) {
    return toErrorCode(error);
  } finally {
    await platform.end().catch(() => undefined);
  }
}

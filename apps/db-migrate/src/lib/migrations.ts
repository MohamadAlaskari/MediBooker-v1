import { readdirSync } from 'node:fs';
import path from 'node:path';
import { ToolError, type ErrorCode } from './errors.ts';

export type SchemaName = 'platform' | 'practice';

/** The folder names Prisma Migrate creates: a 14-digit timestamp and a snake_case name. */
const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+$/;

/**
 * The newest migration folder of a schema under PRISMA_ROOT: the target of every deploy (02 §6),
 * the comment of practice_template and the value the API build records as `*_SCHEMA_REQUIRED`.
 */
export function newestMigration(prismaRoot: string, schema: SchemaName): string {
  const folder = path.join(prismaRoot, 'prisma', schema, 'migrations');
  let names: string[];
  try {
    names = readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    throw new ToolError('MIGRATIONS_NOT_FOUND');
  }
  const newest = names.at(-1);
  if (newest === undefined || names.some((name) => !MIGRATION_NAME.test(name))) {
    throw new ToolError('MIGRATIONS_NOT_FOUND');
  }
  return newest;
}

/** Migration names compare as strings, because their timestamp prefix orders them. */
export function isBehind(schemaVersion: string | null, target: string): boolean {
  return schemaVersion === null || schemaVersion < target;
}

/** What a failed `prisma migrate deploy` run says about the database it ran on. */
export type DeployFailure =
  /** P3009: an unfinished migration from an earlier run blocks every deploy. */
  | { readonly kind: 'blocked' }
  /**
   * The migration failed inside its own `BEGIN; … COMMIT;` and was rolled back. Prisma 7 then
   * records the failure on the same connection, which fails with "current transaction is
   * aborted" and loses the database's own error, also in `_prisma_migrations.logs`.
   */
  | { readonly kind: 'rolled-back' }
  /** P3018 with a recorded database error: a migration without its own transaction failed. */
  | { readonly kind: 'database-error'; readonly sqlState: string | undefined }
  /** Prisma could not connect, authenticate or keep the connection. */
  | { readonly kind: 'connection'; readonly code: ErrorCode }
  | { readonly kind: 'unknown' };

const PRISMA_ERROR = /\bError: (P\d{4})\b/;
const RECORDED_DATABASE_ERROR = /Database error code: ([0-9A-Z]{5})\b/;
/** PostgreSQL's message for SQLSTATE 25P02 (the clusters run with English messages). */
const ABORTED_TRANSACTION =
  'current transaction is aborted, commands ignored until end of transaction block';

const CONNECTION_ERRORS: Readonly<Record<string, ErrorCode>> = {
  P1000: 'DATABASE_AUTH_FAILED',
  P1001: 'DATABASE_UNREACHABLE',
  P1002: 'DATABASE_UNREACHABLE',
  P1003: 'DATABASE_NOT_FOUND',
  P1010: 'DATABASE_PERMISSION_DENIED',
  P1011: 'DATABASE_TLS_FAILED',
  P1017: 'DATABASE_UNREACHABLE',
};

/** Classifies the captured output of a failed deploy; the output is never printed. */
export function classifyDeployFailure(output: string): DeployFailure {
  if (output.includes(ABORTED_TRANSACTION)) return { kind: 'rolled-back' };
  const prismaCode = PRISMA_ERROR.exec(output)?.[1];
  if (prismaCode === 'P3009') return { kind: 'blocked' };
  if (prismaCode === 'P3018') {
    return { kind: 'database-error', sqlState: RECORDED_DATABASE_ERROR.exec(output)?.[1] };
  }
  const connectionCode = prismaCode === undefined ? undefined : CONNECTION_ERRORS[prismaCode];
  if (connectionCode !== undefined) return { kind: 'connection', code: connectionCode };
  return { kind: 'unknown' };
}

/** Whether a `_prisma_migrations.logs` value holds an error the database reported. */
export function hasRecordedDatabaseError(logs: string | null): boolean {
  return logs !== null && RECORDED_DATABASE_ERROR.test(logs);
}

/** The wait before lock retry `attempt` (1, 2, …): exponential, `baseMs`, 2 × `baseMs`, … */
export function lockRetryDelayMs(attempt: number, baseMs: number): number {
  return baseMs * 2 ** (attempt - 1);
}

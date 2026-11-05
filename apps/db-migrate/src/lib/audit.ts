import type { Client } from 'pg';
import { ToolError, type ErrorCode } from './errors.ts';

export type AuditOutcome = 'STARTED' | 'SUCCEEDED' | 'FAILED';

export interface AuditScope {
  /** The operator principal: locally `local:<OS user>`; from OPS01 the task's cloud identity. */
  readonly actor: string;
  /** `medibooker-db.<command>`, for example `medibooker-db.migrate.practices`. */
  readonly action: string;
  /** The practice a command works on, when it names one. */
  readonly practiceId: string | null;
}

const INSERT_EVENT = `INSERT INTO platform_audit_events
  (actor, action, practice_id, outcome, error_code, approval_ref)
  VALUES ($1, $2, $3, $4, $5, NULL)`;

async function insertEvent(
  platform: Client,
  scope: AuditScope,
  outcome: AuditOutcome,
  errorCode: ErrorCode | null,
): Promise<void> {
  await platform.query(INSERT_EVENT, [
    scope.actor,
    scope.action,
    scope.practiceId,
    outcome,
    errorCode,
  ]);
}

/**
 * The STARTED row every lifecycle command writes before it changes anything (ADR 0005 §5.2), as
 * platform_owner. A command that cannot write it does not run. `migrate platform` creates the
 * table itself, so on a platform database without it the row is skipped (`allowMissingTable`).
 */
export async function auditStarted(
  platform: Client,
  scope: AuditScope,
  options: { readonly allowMissingTable?: boolean } = {},
): Promise<void> {
  try {
    await insertEvent(platform, scope, 'STARTED', null);
  } catch (error) {
    const missingTable =
      typeof error === 'object' && error !== null && 'code' in error && error.code === '42P01';
    if (missingTable && options.allowMissingTable === true) return;
    throw new ToolError('AUDIT_WRITE_FAILED');
  }
}

/**
 * The SUCCEEDED or FAILED row after the command. Returns AUDIT_WRITE_FAILED when it cannot be
 * written, so a command that did its work still reports the missing audit row as a failure.
 */
export async function auditFinished(
  platform: Client | undefined,
  scope: AuditScope,
  errorCode: ErrorCode | null,
): Promise<ErrorCode | null> {
  if (platform === undefined) return 'AUDIT_WRITE_FAILED';
  try {
    await insertEvent(platform, scope, errorCode === null ? 'SUCCEEDED' : 'FAILED', errorCode);
    return null;
  } catch {
    return 'AUDIT_WRITE_FAILED';
  }
}

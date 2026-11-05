/**
 * The stable error codes of medibooker-db. They are printed in the JSON lines, stored in
 * practices.migration_error_code and platform_audit_events.error_code, and alerted on by OPS01, so
 * a code keeps its meaning once released. A code never carries a host, user, connection string,
 * secret reference or password (02 §6).
 */
export const ERROR_CODES = [
  // Command line, configuration and environment
  'INVALID_ARGUMENTS',
  'ENVIRONMENT_INVALID',
  'LOCAL_ONLY',
  'OPERATOR_IDENTITY_UNAVAILABLE',
  // Secret store
  'SECRET_STORE_REFUSED',
  'SECRET_STORE_UNAVAILABLE',
  'SECRET_UNRESOLVABLE',
  // Database connections and statements
  'DATABASE_UNREACHABLE',
  'DATABASE_AUTH_FAILED',
  'DATABASE_NOT_FOUND',
  'DATABASE_PERMISSION_DENIED',
  'DATABASE_TLS_FAILED',
  'DATABASE_ERROR',
  'AUDIT_WRITE_FAILED',
  // Migrations
  'RUNNER_BUSY',
  'MIGRATIONS_NOT_FOUND',
  'MIGRATION_FAILED',
  'MIGRATION_LOCK_NOT_AVAILABLE',
  'MIGRATION_TIMEOUT',
  'MIGRATION_STATE_UNKNOWN',
  'PRISMA_CLI_FAILED',
  // Registry, clusters and provisioning
  'PRACTICE_NOT_FOUND',
  'PRACTICE_EXISTS',
  'PRACTICE_STATUS_INVALID',
  'PRACTICE_MARKET_MISMATCH',
  'MARKET_NOT_ALLOWED',
  'PRACTICE_CLUSTER_MISMATCH',
  'PRACTICE_IDENTITY_MISMATCH',
  'PROVISIONING_STOPPED',
  'CLUSTER_NOT_FOUND',
  'CLUSTER_REQUIRED',
  'CLUSTER_DISABLED',
  'CLUSTER_TLS_REQUIRED',
  'ROLE_MISSING',
  'TEMPLATE_STALE',
  // Verification
  'SCHEMA_DRIFT',
  'DATABASE_ACL_INVALID',
  // Anything unexpected; the cause is never printed
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * An expected failure of a command. Its message is the code itself, so printing or logging it
 * can never reveal a host, user, connection string, secret reference or password.
 */
export class ToolError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string = code) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  // too_many_connections, cannot_connect_now, admin_shutdown, crash_shutdown
  '53300',
  '57P03',
  '57P01',
  '57P02',
]);

const TLS_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const SQLSTATE = /^[0-9A-Z]{5}$/;

/** The `code` property of an error from pg, Node or this tool, if it has one. */
function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/**
 * Maps any error to a stable code. Only the code property is read: messages of pg and Node
 * errors can contain a host, a port or a role name.
 */
export function toErrorCode(error: unknown): ErrorCode {
  if (error instanceof ToolError) return error.code;
  const code = codeOf(error);
  if (code === undefined) return 'INTERNAL_ERROR';
  if (code === '28P01' || code === '28000') return 'DATABASE_AUTH_FAILED';
  if (code === '3D000') return 'DATABASE_NOT_FOUND';
  if (code === '42501') return 'DATABASE_PERMISSION_DENIED';
  if (UNREACHABLE_CODES.has(code)) return 'DATABASE_UNREACHABLE';
  if (TLS_CODES.has(code) || code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_')) {
    return 'DATABASE_TLS_FAILED';
  }
  if (SQLSTATE.test(code)) return 'DATABASE_ERROR';
  return 'INTERNAL_ERROR';
}

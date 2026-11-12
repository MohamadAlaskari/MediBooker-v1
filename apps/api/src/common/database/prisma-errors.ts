import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';

/**
 * Reads Prisma errors without their texts (02 §8). With the pg driver adapter, a failed query
 * carries the adapter's cause in `meta.driverAdapterError.cause`: the kind of failure, the
 * database's SQLSTATE (`originalCode`), its severity and, for a unique violation, the index. Only
 * those fields are read, each as a string; the cause's message, detail and values never are.
 */

/** What the driver adapter reported about a failed query. */
export interface DriverFailure {
  readonly kind: string | undefined;
  /** The SQLSTATE of the database error, such as `23505` or `42501`. */
  readonly sqlState: string | undefined;
  readonly severity: string | undefined;
  /** The index of a unique violation. */
  readonly index: string | undefined;
}

/**
 * Failures that mean the connection could not be opened or was lost, whatever the query: a
 * refused or unknown host, an unknown database (3D000), a refused password (28P01) or login
 * (28000), a certificate or host name that did not verify, a reset connection, a socket timeout.
 */
const CONNECTION_KINDS: ReadonlySet<string> = new Set([
  'AuthenticationFailed',
  'DatabaseNotReachable',
  'DatabaseDoesNotExist',
  'DatabaseAccessDenied',
  'TlsConnectionError',
  'ConnectionClosed',
  'SocketTimeout',
]);

const LOCK_NOT_AVAILABLE = '55P03';
/** Two transactions waited for each other, and the database ended one of them. */
const DEADLOCK_DETECTED = '40P01';
const POOL_TIMEOUT_TEXT = 'timeout exceeded when trying to connect';

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** `instanceof`, false also for a value whose prototype cannot be read (a Proxy that throws). */
function isError(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function stringField(source: object, key: string): string | undefined {
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'string' ? value : undefined;
}

/** `instanceof`, false also for a value whose prototype cannot be read (a Proxy that throws). */
export function isPrismaKnownRequestError(value: unknown): value is PrismaClientKnownRequestError {
  try {
    return value instanceof PrismaClientKnownRequestError;
  } catch {
    return false;
  }
}

/** The driver adapter's report of a Prisma error, or undefined for any other error. */
export function driverFailureOf(error: unknown): DriverFailure | undefined {
  if (!isPrismaKnownRequestError(error)) return undefined;
  const adapterError: unknown = error.meta?.driverAdapterError;
  const cause: unknown = isObject(adapterError) ? Reflect.get(adapterError, 'cause') : undefined;
  if (!isObject(cause)) return undefined;
  const constraint: unknown = Reflect.get(cause, 'constraint');
  return {
    kind: stringField(cause, 'kind'),
    sqlState: stringField(cause, 'originalCode'),
    severity: stringField(cause, 'severity'),
    index: isObject(constraint) ? stringField(constraint, 'index') : undefined,
  };
}

/**
 * True when a query failed because its connection failed (02 §5 item 7): one of the connection
 * kinds above, or a database error of severity FATAL, which ends the session (permission denied
 * for the database on connect, 42501; terminated by an administrator, 57P01). Errors without a
 * driver report, such as pg's own connect timeout, are not recognised here.
 */
export function isConnectionFailure(error: unknown): boolean {
  const failure = driverFailureOf(error);
  if (failure?.kind === undefined) return false;
  if (CONNECTION_KINDS.has(failure.kind)) return true;
  return (
    failure.kind === 'postgres' && (failure.severity === 'FATAL' || failure.severity === 'PANIC')
  );
}

/**
 * True when the database is busy, not broken: no connection of the pool came free in time, a
 * transaction could not start or ran out of time (P2028), a row lock did not come free (55P03), or
 * the database ended a transaction that waited in a circle with another one (40P01): a retry can
 * pass. pg's own connect timeout has no code, only this constant text.
 */
export function isDatabaseBusy(error: unknown): boolean {
  if (isPrismaKnownRequestError(error)) {
    const sqlState = driverFailureOf(error)?.sqlState;
    return (
      error.code === 'P2028' || sqlState === LOCK_NOT_AVAILABLE || sqlState === DEADLOCK_DETECTED
    );
  }
  return isError(error) && error.message.includes(POOL_TIMEOUT_TEXT);
}

/** True when the database refused the password (28P01). */
export function isAuthenticationFailure(error: unknown): boolean {
  return driverFailureOf(error)?.kind === 'AuthenticationFailed';
}

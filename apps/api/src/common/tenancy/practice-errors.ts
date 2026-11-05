/**
 * Why a practice cannot be served (05 §1.3: logged with the practice id and this code, never with
 * connection details). The HTTP answer is 503 with `Retry-After` for every reason.
 */
export type PracticeUnavailableReason =
  /** runInPractice only: no registry row, or a status that HTTP answers with 404. */
  | 'PRACTICE_NOT_FOUND'
  /** Suspended, moving or under restore review (ADR 0005 §5). */
  | 'PRACTICE_STATUS_UNAVAILABLE'
  /** Its market is not in this deployment's MARKETS (ADR 0005 §7.2). */
  | 'PRACTICE_MARKET_NOT_SERVED'
  /** Its schema_version is older than PRACTICE_SCHEMA_REQUIRED (ADR 0005 §6.8). */
  | 'PRACTICE_SCHEMA_BEHIND'
  /** A status that may be served without a cluster, database or secret reference. */
  | 'PRACTICE_ROUTE_INCOMPLETE'
  /** Its cluster is not registered. */
  | 'PRACTICE_CLUSTER_UNKNOWN'
  /** A cluster without TLS outside APP_ENV local and ci (ADR 0005 §4.9). */
  | 'PRACTICE_TLS_REQUIRED'
  /** The secret store could not resolve a reference. */
  | 'PRACTICE_SECRET_UNAVAILABLE'
  /** The database refused the password, also after reading it again (28P01). */
  | 'PRACTICE_AUTHENTICATION_FAILED'
  /** The connection failed: refused, unknown database, no CONNECT, terminated, TLS. */
  | 'PRACTICE_CONNECTION_FAILED'
  /** The database's practice_identity names another practice (ADR 0005 §2.2). */
  | 'PRACTICE_IDENTITY_MISMATCH'
  /** The database's CONNECT is open to PUBLIC (ADR 0005 §4.2). */
  | 'PRACTICE_ACL_OPEN'
  /** No client could be freed within the wait of the connection manager. */
  | 'PRACTICE_CAPACITY_EXHAUSTED'
  /** A public acquisition above PRACTICE_CLIENT_CREATIONS_PER_SECOND. */
  | 'PRACTICE_CREATION_RATE_EXCEEDED';

/** A practice that cannot be served now (ADR 0005 §5): 503 for that practice only. */
export class PracticeUnavailableError extends Error {
  constructor(
    readonly practiceId: string,
    readonly reason: PracticeUnavailableReason,
    options?: ErrorOptions,
  ) {
    super('practice unavailable', options);
  }
}

/**
 * Practice data accessed without a resolved practice (ADR 0005 §2.5): a bug, never a client
 * error. X01 answers it with INTERNAL_ERROR.
 */
export class PracticeContextMissingError extends Error {
  constructor() {
    super('practice data accessed without a resolved practice');
  }
}

import type { Env } from '../../config/env.schema.js';
import type { PracticeStatus } from '../../generated/platform/enums.js';
import type { PracticeUnavailableReason } from './practice-errors.js';
import type { PracticePurpose } from './practice-route.js';

/**
 * Whether a practice may be served, decided before any practice client is leased: the status
 * table, the market check and the schema guard (ADR 0005 §5.1, §6.8, §7.2). Pure functions.
 */

/** How an entry point answers a practice: serve it, or 404, or 503 with `Retry-After`. */
export type StatusAnswer = 'SERVE' | 'NOT_FOUND' | 'UNAVAILABLE';

/**
 * The status table of ADR 0005 §5.1. The purposes are its columns: `public` "Public requests",
 * `request` "Signed-in requests" and `job` "Jobs and relay", where "no" and "paused" are not
 * served. Under restore review only the practice's management is to be served (D17); until that is
 * built, every signed-in request gets 503.
 */
const STATUS_TABLE: Readonly<
  Record<PracticeStatus, Readonly<Record<Exclude<PracticePurpose, 'fanOut'>, StatusAnswer>>>
> = {
  PROVISIONING: { public: 'NOT_FOUND', request: 'NOT_FOUND', job: 'NOT_FOUND' },
  ACTIVE: { public: 'SERVE', request: 'SERVE', job: 'SERVE' },
  SUSPENDED: { public: 'UNAVAILABLE', request: 'UNAVAILABLE', job: 'UNAVAILABLE' },
  MOVING: { public: 'UNAVAILABLE', request: 'UNAVAILABLE', job: 'UNAVAILABLE' },
  RESTORE_REVIEW: { public: 'UNAVAILABLE', request: 'UNAVAILABLE', job: 'UNAVAILABLE' },
  DEPROVISIONING: { public: 'NOT_FOUND', request: 'NOT_FOUND', job: 'NOT_FOUND' },
  FINALIZED: { public: 'NOT_FOUND', request: 'NOT_FOUND', job: 'NOT_FOUND' },
};

/** A fan-out is a signed-in request with a budget of its own: the table has no column for it. */
export function statusAnswer(status: PracticeStatus, purpose: PracticePurpose): StatusAnswer {
  return STATUS_TABLE[status][purpose === 'fanOut' ? 'request' : purpose];
}

/** The deployment-wide inputs of the checks. */
export interface DeploymentScope {
  readonly appEnv: Env['APP_ENV'];
  readonly markets: readonly string[];
  /** PRACTICE_SCHEMA_REQUIRED: the newest practice migration of this build. */
  readonly practiceSchemaRequired: string;
}

/** Staging and production serve only the markets in MARKETS; undefined: local and ci serve all. */
export function servedMarkets(
  scope: Pick<DeploymentScope, 'appEnv' | 'markets'>,
): readonly string[] | undefined {
  return scope.appEnv === 'local' || scope.appEnv === 'ci' ? undefined : scope.markets;
}

export function isMarketServed(market: string, scope: DeploymentScope): boolean {
  return servedMarkets(scope)?.includes(market) ?? true;
}

/**
 * A practice whose schema is not older than the code's. Migration names start with their
 * timestamp, so they compare as strings; a practice without a schema_version is behind.
 */
export function isSchemaCurrent(schemaVersion: string | null, required: string): boolean {
  return schemaVersion !== null && schemaVersion >= required;
}

export type PracticeVerdict =
  | { readonly answer: 'SERVE' }
  | { readonly answer: 'NOT_FOUND' }
  | { readonly answer: 'UNAVAILABLE'; readonly reason: PracticeUnavailableReason };

/** The registry fields the checks read. */
export interface PracticeState {
  readonly status: PracticeStatus;
  readonly market: string;
  readonly schemaVersion: string | null;
}

/**
 * The status table first (a 404 hides the practice before anything else is checked), then the
 * market, then the schema guard.
 */
export function practiceVerdict(
  practice: PracticeState,
  purpose: PracticePurpose,
  scope: DeploymentScope,
): PracticeVerdict {
  const answer = statusAnswer(practice.status, purpose);
  if (answer === 'NOT_FOUND') return { answer };
  if (answer === 'UNAVAILABLE') return { answer, reason: 'PRACTICE_STATUS_UNAVAILABLE' };
  if (!isMarketServed(practice.market, scope)) {
    return { answer: 'UNAVAILABLE', reason: 'PRACTICE_MARKET_NOT_SERVED' };
  }
  if (!isSchemaCurrent(practice.schemaVersion, scope.practiceSchemaRequired)) {
    return { answer: 'UNAVAILABLE', reason: 'PRACTICE_SCHEMA_BEHIND' };
  }
  return { answer: 'SERVE' };
}

import type { PracticeStatus } from '../../generated/platform/enums.js';

/**
 * Why a practice client is acquired (02 §5): a signed-in request, a public (slug) request or a
 * job. The connection manager's budgets and the status table depend on it.
 */
export type PracticePurpose = 'request' | 'public' | 'job';

/** The registry row of a practice that may be served: its route to its own database. */
export interface PracticeRoute {
  readonly id: string;
  readonly status: PracticeStatus;
  readonly market: string;
  readonly clusterId: string;
  readonly databaseName: string;
  readonly appSecretRef: string;
  readonly routeVersion: number;
  readonly schemaVersion: string;
}

/** What the registry says about a published practice (P02): its current slug and public name. */
export interface PracticeListing {
  readonly slug: string;
  /** Text per locale. */
  readonly name: unknown;
}

const PRACTICE_SLUG = /^[a-z0-9-]{3,40}$/;

/** Whether a path segment can be a slug at all: the form `practice_slugs` has a CHECK for. */
export function isPracticeSlug(value: string | undefined): value is string {
  return value !== undefined && PRACTICE_SLUG.test(value);
}

/** The practice of the current request or `runInPractice` call (02 §4, ADR 0005 §2.5). */
export interface ResolvedPractice {
  readonly id: string;
  readonly market: string;
  readonly routeVersion: number;
  readonly schemaVersion: string;
}

export function resolvedPracticeOf(route: PracticeRoute): ResolvedPractice {
  return {
    id: route.id,
    market: route.market,
    routeVersion: route.routeVersion,
    schemaVersion: route.schemaVersion,
  };
}

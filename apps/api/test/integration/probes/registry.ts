import type { PracticeStatus } from '../../../src/generated/platform/enums.js';
import { withClient } from '../support/sql.js';

/**
 * Registry changes that only medibooker-db makes in production (ADR 0005 §4.4), written by the
 * specs as platform_owner: lifecycle status, market, schema version and routing.
 */
export interface RegistryChange {
  readonly status?: PracticeStatus;
  readonly market?: string;
  readonly schemaVersion?: string | null;
  readonly databaseName?: string | null;
  readonly appSecretRef?: string;
  /** Increments route_version, as every routing change does, so a new client is opened. */
  readonly newRouteVersion?: boolean;
}

const COLUMNS = {
  status: 'status',
  market: 'market',
  schemaVersion: 'schema_version',
  databaseName: 'database_name',
  appSecretRef: 'app_secret_ref',
} as const satisfies Partial<Record<keyof RegistryChange, string>>;

/** Applies a change to one registry row; `platformOwnerUrl` is PLATFORM_MIGRATION_URL. */
export async function changeRegistry(
  platformOwnerUrl: string,
  practiceId: string,
  change: RegistryChange,
): Promise<void> {
  const values: unknown[] = [practiceId];
  const assignments = ['updated_at = now()'];
  for (const [key, column] of Object.entries(COLUMNS)) {
    if (!(key in change)) continue;
    values.push(change[key as keyof typeof COLUMNS]);
    assignments.push(`${column} = $${String(values.length)}`);
  }
  if (change.newRouteVersion === true) assignments.push('route_version = route_version + 1');
  await withClient(platformOwnerUrl, async (platform) => {
    const result = await platform.query(
      `UPDATE practices SET ${assignments.join(', ')} WHERE id = $1`,
      values,
    );
    if (result.rowCount !== 1) throw new Error('no registry row for the practice');
  });
}

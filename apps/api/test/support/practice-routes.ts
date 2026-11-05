import type { PracticeRoute } from '../../src/common/tenancy/practice-route.js';
import { PRACTICE_SCHEMA_REQUIRED } from '../../src/generated/schema-versions.js';

/**
 * Registry routes of synthetic practices for unit tests without a database: ids, database names
 * and secret references in the forms provisioning gives them (02 §6).
 */
export function practiceRoute(id: string, overrides: Partial<PracticeRoute> = {}): PracticeRoute {
  const id32 = id.replaceAll('-', '');
  return {
    id,
    status: 'ACTIVE',
    market: 'SA',
    clusterId: 'local',
    databaseName: `practice_${id32}`,
    appSecretRef: `dev:practice_${id32}_app`,
    routeVersion: 1,
    schemaVersion: PRACTICE_SCHEMA_REQUIRED,
    ...overrides,
  };
}

export const PRACTICE_A = '00000000-0000-4000-8000-00000000000a';
export const PRACTICE_B = '00000000-0000-4000-8000-00000000000b';
export const PRACTICE_C = '00000000-0000-4000-8000-00000000000c';
export const PRACTICE_D = '00000000-0000-4000-8000-00000000000d';

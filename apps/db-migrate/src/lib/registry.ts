import type { Client } from 'pg';
import type { ClusterRecord, Endpoint } from './cluster.ts';
import type { ErrorCode } from './errors.ts';

/**
 * The platform registry as medibooker-db reads and writes it, always as platform_owner: only the
 * lifecycle commands change status, routing, secret references and schema versions (ADR 0005
 * §4.4). Every write that would repeat an earlier one is a no-op, so reruns change nothing.
 */

export const PRACTICE_STATUSES = [
  'PROVISIONING',
  'ACTIVE',
  'SUSPENDED',
  'MOVING',
  'RESTORE_REVIEW',
  'DEPROVISIONING',
  'FINALIZED',
] as const;

export type PracticeStatus = (typeof PRACTICE_STATUSES)[number];

/** The statuses the migration runner and `verify` work on (ADR 0005 §5.1). */
export const MIGRATED_STATUSES: readonly PracticeStatus[] = [
  'ACTIVE',
  'SUSPENDED',
  'RESTORE_REVIEW',
];

export interface PracticeRecord {
  readonly id: string;
  readonly status: PracticeStatus;
  readonly market: string;
  readonly clusterId: string | null;
  readonly databaseName: string | null;
  readonly appSecretRef: string | null;
  readonly ownerSecretRef: string | null;
  readonly schemaVersion: string | null;
}

interface PracticeRow {
  id: string;
  status: PracticeStatus;
  market: string;
  cluster_id: string | null;
  database_name: string | null;
  app_secret_ref: string | null;
  owner_secret_ref: string | null;
  schema_version: string | null;
}

const PRACTICE_COLUMNS =
  'id, status, market, cluster_id, database_name, app_secret_ref, owner_secret_ref, schema_version';

function toPractice(row: PracticeRow): PracticeRecord {
  return {
    id: row.id,
    status: row.status,
    market: row.market,
    clusterId: row.cluster_id,
    databaseName: row.database_name,
    appSecretRef: row.app_secret_ref,
    ownerSecretRef: row.owner_secret_ref,
    schemaVersion: row.schema_version,
  };
}

export async function readPractice(
  platform: Client,
  practiceId: string,
): Promise<PracticeRecord | undefined> {
  const result = await platform.query<PracticeRow>(
    `SELECT ${PRACTICE_COLUMNS} FROM practices WHERE id = $1`,
    [practiceId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : toPractice(row);
}

/** The practices in the given statuses, optionally only one, in a stable order. */
export async function listPractices(
  platform: Client,
  statuses: readonly PracticeStatus[],
  practiceId?: string,
): Promise<PracticeRecord[]> {
  const result = await platform.query<PracticeRow>(
    `SELECT ${PRACTICE_COLUMNS} FROM practices
     WHERE status = ANY($1::practice_status[]) AND ($2::uuid IS NULL OR id = $2::uuid)
     ORDER BY id`,
    [statuses, practiceId ?? null],
  );
  return result.rows.map(toPractice);
}

/** Step 1 of provisioning: the registry row, status PROVISIONING (the column default). */
export async function insertPractice(
  platform: Client,
  practiceId: string,
  market: string,
): Promise<void> {
  await platform.query(
    'INSERT INTO practices (id, market) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
    [practiceId, market],
  );
}

/** Step 2: the cluster and the database name, set once. */
export async function placePractice(
  platform: Client,
  practiceId: string,
  clusterId: string,
  databaseName: string,
): Promise<void> {
  await platform.query(
    `UPDATE practices SET cluster_id = $2, database_name = $3, updated_at = now()
     WHERE id = $1 AND cluster_id IS NULL`,
    [practiceId, clusterId, databaseName],
  );
}

/** Step 3: the secret references, set once; the secrets behind them are reused on a rerun. */
export async function setSecretRefs(
  platform: Client,
  practiceId: string,
  appSecretRef: string,
  ownerSecretRef: string,
): Promise<void> {
  await platform.query(
    `UPDATE practices SET app_secret_ref = $2, owner_secret_ref = $3, updated_at = now()
     WHERE id = $1 AND app_secret_ref IS NULL AND owner_secret_ref IS NULL`,
    [practiceId, appSecretRef, ownerSecretRef],
  );
}

/** After a deploy: the schema version and the time, or the error code (ADR 0005 §6.2). */
export async function recordDeployOutcome(
  platform: Client,
  practiceId: string,
  schemaVersion: string | null,
  errorCode: ErrorCode | null,
): Promise<void> {
  if (errorCode === null) {
    await platform.query(
      `UPDATE practices
       SET schema_version = $2, migrated_at = now(), migration_error_code = NULL, updated_at = now()
       WHERE id = $1 AND (schema_version IS DISTINCT FROM $2 OR migration_error_code IS NOT NULL)`,
      [practiceId, schemaVersion],
    );
    return;
  }
  await platform.query(
    `UPDATE practices
     SET schema_version = COALESCE($2, schema_version), migration_error_code = $3, updated_at = now()
     WHERE id = $1`,
    [practiceId, schemaVersion, errorCode],
  );
}

/** The last step of provisioning. */
export async function activatePractice(platform: Client, practiceId: string): Promise<void> {
  await platform.query(
    `UPDATE practices SET status = 'ACTIVE', updated_at = now()
     WHERE id = $1 AND status = 'PROVISIONING'`,
    [practiceId],
  );
}

/** A template copy of local and CI tests: registered with its routing at once, ACTIVE. */
export async function insertRoutedPractice(
  platform: Client,
  practice: {
    readonly practiceId: string;
    readonly market: string;
    readonly clusterId: string;
    readonly databaseName: string;
    readonly appSecretRef: string;
    readonly ownerSecretRef: string;
    readonly schemaVersion: string;
  },
): Promise<void> {
  await platform.query(
    `INSERT INTO practices (id, status, market, cluster_id, database_name, app_secret_ref,
       owner_secret_ref, schema_version, migrated_at)
     VALUES ($1, 'ACTIVE', $2, $3, $4, $5, $6, $7, now())`,
    [
      practice.practiceId,
      practice.market,
      practice.clusterId,
      practice.databaseName,
      practice.appSecretRef,
      practice.ownerSecretRef,
      practice.schemaVersion,
    ],
  );
}

/** Teardown, step 1: a running API stops using its cached client (06 §3). */
export async function markDeprovisioning(platform: Client, practiceId: string): Promise<void> {
  await platform.query(
    `UPDATE practices SET status = 'DEPROVISIONING', updated_at = now()
     WHERE id = $1 AND status <> 'DEPROVISIONING'`,
    [practiceId],
  );
}

/** Teardown, last step: the slugs and the registry row; the audit rows stay. */
export async function deletePractice(platform: Client, practiceId: string): Promise<void> {
  await platform.query('BEGIN');
  try {
    await platform.query('DELETE FROM practice_slugs WHERE practice_id = $1', [practiceId]);
    await platform.query('DELETE FROM practices WHERE id = $1', [practiceId]);
    await platform.query('COMMIT');
  } catch (error) {
    await platform.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

interface ClusterRow {
  id: string;
  host: string;
  port: number;
  tls_mode: 'DISABLE' | 'VERIFY_FULL';
  ca_secret_ref: string | null;
  provisioner_secret_ref: string | null;
  status: 'ACTIVE' | 'DISABLED';
}

const CLUSTER_COLUMNS = 'id, host, port, tls_mode, ca_secret_ref, provisioner_secret_ref, status';

function toCluster(row: ClusterRow): ClusterRecord {
  return {
    id: row.id,
    host: row.host,
    port: row.port,
    tlsMode: row.tls_mode,
    caSecretRef: row.ca_secret_ref,
    provisionerSecretRef: row.provisioner_secret_ref,
    status: row.status,
  };
}

export async function readCluster(
  platform: Client,
  clusterId: string,
): Promise<ClusterRecord | undefined> {
  const result = await platform.query<ClusterRow>(
    `SELECT ${CLUSTER_COLUMNS} FROM database_clusters WHERE id = $1`,
    [clusterId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : toCluster(row);
}

export async function listClusters(platform: Client): Promise<ClusterRecord[]> {
  const result = await platform.query<ClusterRow>(
    `SELECT ${CLUSTER_COLUMNS} FROM database_clusters ORDER BY id`,
  );
  return result.rows.map(toCluster);
}

/** The id of the cluster that local and CI provisioning registers (02 §6). */
export const LOCAL_CLUSTER_ID = 'local';

/** How many practice databases the local cluster accepts; production limits come from OPS01. */
const LOCAL_CLUSTER_DATABASE_LIMIT = 1000;

/**
 * Registers the cluster `local` from PROVISIONER_DATABASE_URL (local and ci only): no TLS, and
 * the provisioner's credentials are that variable itself.
 */
export async function registerLocalCluster(platform: Client, endpoint: Endpoint): Promise<void> {
  await platform.query(
    `INSERT INTO database_clusters
       (id, region, host, port, tls_mode, ca_secret_ref, provisioner_secret_ref, database_limit)
     VALUES ($1, 'local', $2, $3, 'DISABLE', NULL, 'env:PROVISIONER_DATABASE_URL', $4)
     ON CONFLICT (id) DO NOTHING`,
    [LOCAL_CLUSTER_ID, endpoint.host, endpoint.port, LOCAL_CLUSTER_DATABASE_LIMIT],
  );
}

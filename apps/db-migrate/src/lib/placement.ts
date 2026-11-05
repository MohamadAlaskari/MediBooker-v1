import type { Client } from 'pg';
import { isLocalOrCi, type AppEnv } from './app-env.ts';
import {
  endpointFromUrl,
  pgConnectionConfig,
  type ClusterAccess,
  type ClusterRecord,
} from './cluster.ts';
import { connect, TOOL_APPLICATION_NAME } from './database.ts';
import { ToolError } from './errors.ts';
import type { PracticeNames } from './names.ts';
import { listClusters, readCluster, registerLocalCluster } from './registry.ts';

export interface PlacementOptions {
  readonly appEnv: AppEnv;
  /** `--cluster`; otherwise the deployment's only active cluster. */
  readonly clusterId: string | undefined;
  /** PROVISIONER_DATABASE_URL, which registers the cluster `local` in local and ci. */
  readonly provisionerUrl: string | undefined;
}

/**
 * The cluster of a practice (ADR 0005 §5.3, step 2): the one it is placed on, or for a new
 * practice `--cluster` or the deployment's only active cluster. In local and ci an empty cluster
 * table first gets the cluster `local` from PROVISIONER_DATABASE_URL (02 §6).
 */
export async function chooseCluster(
  platform: Client,
  placedOn: string | null,
  options: PlacementOptions,
): Promise<ClusterRecord> {
  if (placedOn !== null) {
    if (options.clusterId !== undefined && options.clusterId !== placedOn) {
      throw new ToolError('PRACTICE_CLUSTER_MISMATCH');
    }
    const cluster = await readCluster(platform, placedOn);
    if (cluster === undefined) throw new ToolError('CLUSTER_NOT_FOUND');
    return cluster;
  }
  let clusters = await listClusters(platform);
  if (
    clusters.length === 0 &&
    isLocalOrCi(options.appEnv) &&
    options.provisionerUrl !== undefined
  ) {
    await registerLocalCluster(platform, endpointFromUrl(options.provisionerUrl));
    clusters = await listClusters(platform);
  }
  const candidates =
    options.clusterId === undefined
      ? clusters.filter((cluster) => cluster.status === 'ACTIVE')
      : clusters.filter((cluster) => cluster.id === options.clusterId);
  const [cluster, ...others] = candidates;
  if (cluster === undefined) throw new ToolError('CLUSTER_NOT_FOUND');
  if (others.length > 0) throw new ToolError('CLUSTER_REQUIRED');
  if (cluster.status !== 'ACTIVE') throw new ToolError('CLUSTER_DISABLED');
  return cluster;
}

/**
 * A provisioned practice, as the test helpers return it. The owner's password stays inside
 * `connectAsOwner`, so printing the object can never show it.
 */
export interface ProvisionedPractice {
  readonly practiceId: string;
  readonly databaseName: string;
  readonly appRole: string;
  readonly ownerRole: string;
  readonly clusterId: string;
  /** Opens a connection to the practice database as its owner role; the caller ends it. */
  readonly connectAsOwner: () => Promise<Client>;
}

export function provisionedPractice(
  names: PracticeNames,
  access: ClusterAccess,
  ownerPassword: string,
): ProvisionedPractice {
  const config = pgConnectionConfig(
    access,
    { user: names.ownerRole, password: ownerPassword, database: names.databaseName },
    TOOL_APPLICATION_NAME,
  );
  return {
    practiceId: names.practiceId,
    databaseName: names.databaseName,
    appRole: names.appRole,
    ownerRole: names.ownerRole,
    clusterId: access.clusterId,
    connectAsOwner: () => connect(config),
  };
}

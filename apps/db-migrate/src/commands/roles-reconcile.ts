import type { Client } from 'pg';
import {
  clusterAccessResolver,
  credentialsFromUrl,
  pgConnectionConfig,
  type ClusterRecord,
  type Credentials,
} from '../lib/cluster.ts';
import {
  requireSecretStore,
  runAudited,
  type ExitCode,
  type PracticeCommandOptions,
} from '../lib/command.ts';
import { TOOL_APPLICATION_NAME, withConnection } from '../lib/database.ts';
import { toErrorCode, ToolError, type ErrorCode } from '../lib/errors.ts';
import { practiceNames } from '../lib/names.ts';
import { elapsedMs, practiceLine, type OutputSink } from '../lib/output.ts';
import {
  listClusters,
  listPractices,
  type PracticeRecord,
  type PracticeStatus,
} from '../lib/registry.ts';
import { applyRoleSettings, type ConnectionLimits } from '../lib/roles.ts';
import type { SecretStore } from '../lib/secret-store.ts';

export interface ReconcileRolesOptions extends PracticeCommandOptions {
  /** `--practice <id>`: only this practice. */
  readonly practiceId: string | undefined;
  readonly connectionLimits: ConnectionLimits;
}

/** The statuses in which a practice's database and roles exist (ADR 0005 §5.1). */
const ROLE_STATUSES: readonly PracticeStatus[] = [
  'ACTIVE',
  'SUSPENDED',
  'MOVING',
  'RESTORE_REVIEW',
  'DEPROVISIONING',
];

/** Applies the limits to every practice of one cluster on one provisioner connection. */
async function reconcileCluster(
  provisioner: Client,
  practices: readonly PracticeRecord[],
  limits: ConnectionLimits,
  output: OutputSink,
): Promise<number> {
  let failed = 0;
  for (const practice of practices) {
    const start = performance.now();
    let errorCode: ErrorCode | null = null;
    try {
      await applyRoleSettings(provisioner, practiceNames(practice.id), limits);
    } catch (error) {
      errorCode = toErrorCode(error);
      failed += 1;
    }
    output.write(practiceLine(practice.id, null, null, start, errorCode));
  }
  return failed;
}

async function provisionerCredentials(
  cluster: ClusterRecord | undefined,
  store: SecretStore,
): Promise<Credentials> {
  const ref = cluster?.provisionerSecretRef ?? null;
  if (ref === null) throw new ToolError('SECRET_UNRESOLVABLE');
  return credentialsFromUrl(await store.get(ref));
}

/**
 * `roles reconcile [--practice <id>]` (02 §6): applies PRACTICE_APP_CONNECTION_LIMIT,
 * PRACTICE_OWNER_CONNECTION_LIMIT and the app role's timeouts to every practice's roles, as
 * medibooker_provisioner on each practice's cluster, for example after a limit changed.
 */
export async function reconcileRoles(options: ReconcileRolesOptions): Promise<ExitCode> {
  const start = performance.now();
  let practiceCount = 0;
  let failed = 0;
  const errorCode = await runAudited(
    options,
    { action: 'medibooker-db.roles.reconcile', practiceId: options.practiceId ?? null },
    async (platform) => {
      const store = requireSecretStore(options.secretStore);
      const practices = await listPractices(platform, ROLE_STATUSES, options.practiceId);
      if (options.practiceId !== undefined && practices.length === 0) {
        throw new ToolError('PRACTICE_NOT_FOUND');
      }
      practiceCount = practices.length;
      const clusters = await listClusters(platform);
      const accessOf = clusterAccessResolver(clusters, {
        appEnv: options.appEnv,
        endpoints: options.clusterEndpoints,
        secretStore: store,
      });
      const byCluster = Map.groupBy(practices, (practice) => practice.clusterId);
      for (const [clusterId, group] of byCluster) {
        try {
          const cluster = clusters.find((candidate) => candidate.id === clusterId);
          const access = await accessOf(clusterId);
          const credentials = await provisionerCredentials(cluster, store);
          failed += await withConnection(
            pgConnectionConfig(access, credentials, TOOL_APPLICATION_NAME),
            (provisioner) =>
              reconcileCluster(provisioner, group, options.connectionLimits, options.output),
          );
        } catch (error) {
          const code = toErrorCode(error);
          for (const practice of group) {
            options.output.write(practiceLine(practice.id, null, null, start, code));
          }
          failed += group.length;
        }
      }
      return null;
    },
  );
  options.output.write({
    command: 'roles reconcile',
    practices: practiceCount,
    failed,
    durationMs: elapsedMs(start),
    errorCode,
  });
  return errorCode === null && failed === 0 ? 0 : 1;
}

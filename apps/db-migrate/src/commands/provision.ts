import type { Client } from 'pg';
import { isLocalOrCi } from '../lib/app-env.ts';
import {
  createCaFiles,
  credentialsFromUrl,
  pgConnectionConfig,
  resolveClusterAccess,
} from '../lib/cluster.ts';
import {
  requireSecretStore,
  runAudited,
  type ExitCode,
  type PracticeCommandOptions,
} from '../lib/command.ts';
import { TOOL_APPLICATION_NAME, withConnection } from '../lib/database.ts';
import {
  DEFAULT_LOCK_RETRY_BASE_MS,
  deployWithRecovery,
  practiceDeployTarget,
} from '../lib/deploy.ts';
import { toErrorCode, ToolError, type ErrorCode } from '../lib/errors.ts';
import { practiceNames, type PracticeNames } from '../lib/names.ts';
import { elapsedMs, practiceLine } from '../lib/output.ts';
import { chooseCluster, provisionedPractice, type ProvisionedPractice } from '../lib/placement.ts';
import { createPracticeDatabase, writePracticeIdentity } from '../lib/practice-database.ts';
import {
  activatePractice,
  insertPractice,
  placePractice,
  readPractice,
  recordDeployOutcome,
  setSecretRefs,
} from '../lib/registry.ts';
import { ensurePracticeRoles, type ConnectionLimits, type RolePasswords } from '../lib/roles.ts';
import type { SecretStore } from '../lib/secret-store.ts';

export interface ProvisionOptions extends PracticeCommandOptions {
  readonly practiceId: string;
  /** ISO 3166-1 alpha-2; in staging and production it must be in MARKETS (ADR 0005 §7.2). */
  readonly market: string;
  /** `--cluster`; otherwise the deployment's only active cluster. */
  readonly clusterId: string | undefined;
  /** PROVISIONER_DATABASE_URL (local and ci): registers the cluster `local` when none exists. */
  readonly provisionerUrl: string | undefined;
  readonly markets: readonly string[] | undefined;
  readonly connectionLimits: ConnectionLimits;
  readonly migrationTimeoutMs: number;
  readonly migrationLockRetries: number;
  readonly lockRetryBaseMs?: number;
  /** Test seam: stop after the role step, as a run that crashed there would. */
  readonly stopAfter?: 'roles';
}

export interface ProvisionResult {
  readonly exitCode: ExitCode;
  readonly errorCode: ErrorCode | null;
  /** The practice, after a completed run. */
  readonly practice: ProvisionedPractice | undefined;
}

interface RunState {
  from: string | null;
  to: string | null;
  practice: ProvisionedPractice | undefined;
}

/**
 * Steps 1 to 7 of ADR 0005 §5.3 on one platform connection. Every step checks its result first,
 * so a rerun after any failure completes the practice, and a rerun of a provisioned practice
 * changes nothing. Everything on the practice's cluster runs as medibooker_provisioner, the
 * migration and the identity row as the practice's owner, never as a superuser.
 */
async function provisionSteps(
  platform: Client,
  names: PracticeNames,
  store: SecretStore,
  defaultPasswords: RolePasswords,
  options: ProvisionOptions,
  state: RunState,
): Promise<ErrorCode | null> {
  // 1. The registry row, PROVISIONING until the last step.
  await insertPractice(platform, names.practiceId, options.market);
  const row = await readPractice(platform, names.practiceId);
  if (row === undefined) throw new ToolError('PRACTICE_NOT_FOUND');
  if (row.market !== options.market) throw new ToolError('PRACTICE_MARKET_MISMATCH');
  if (row.status !== 'PROVISIONING' && row.status !== 'ACTIVE') {
    throw new ToolError('PRACTICE_STATUS_INVALID');
  }
  state.from = row.schemaVersion;

  // 2. Placement.
  const cluster = await chooseCluster(platform, row.clusterId, options);
  await placePractice(platform, names.practiceId, cluster.id, names.databaseName);

  // 3. The secrets (generated once, reused on a rerun), then both roles.
  const appSecretRef = row.appSecretRef ?? names.appSecretRef;
  const ownerSecretRef = row.ownerSecretRef ?? names.ownerSecretRef;
  const passwords: RolePasswords = {
    app:
      appSecretRef === names.appSecretRef ? defaultPasswords.app : await store.ensure(appSecretRef),
    owner:
      ownerSecretRef === names.ownerSecretRef
        ? defaultPasswords.owner
        : await store.ensure(ownerSecretRef),
  };
  await setSecretRefs(platform, names.practiceId, appSecretRef, ownerSecretRef);
  const access = await resolveClusterAccess(cluster, {
    appEnv: options.appEnv,
    endpoints: options.clusterEndpoints,
    secretStore: store,
  });
  if (cluster.provisionerSecretRef === null) throw new ToolError('SECRET_UNRESOLVABLE');
  const provisioner = credentialsFromUrl(await store.get(cluster.provisionerSecretRef));
  await withConnection(
    pgConnectionConfig(access, provisioner, TOOL_APPLICATION_NAME),
    async (client) => {
      await ensurePracticeRoles(client, names, passwords, options.connectionLimits);
      if (options.stopAfter === 'roles') throw new ToolError('PROVISIONING_STOPPED');
      // 4. The database with its ACL and app-role setting.
      await createPracticeDatabase(client, names);
    },
  );

  // 5. The migrations, as the owner; the schema version in the registry.
  const owner = { user: names.ownerRole, password: passwords.owner, database: names.databaseName };
  const caFiles = createCaFiles();
  try {
    const outcome = await deployWithRecovery(
      practiceDeployTarget(access, owner, await caFiles.pathFor(access)),
      {
        prismaRoot: options.prismaRoot,
        timeoutMs: options.migrationTimeoutMs,
        lockRetries: options.migrationLockRetries,
        lockRetryBaseMs: options.lockRetryBaseMs ?? DEFAULT_LOCK_RETRY_BASE_MS,
      },
    );
    state.to = outcome.schemaVersion;
    await recordDeployOutcome(platform, names.practiceId, outcome.schemaVersion, outcome.errorCode);
    if (outcome.errorCode !== null) return outcome.errorCode;
  } finally {
    await caFiles.dispose();
  }

  // 6. The identity row, as the owner (the app role cannot write it).
  await withConnection(pgConnectionConfig(access, owner, TOOL_APPLICATION_NAME), (client) =>
    writePracticeIdentity(client, names.practiceId),
  );

  // 7. Routing is complete: ACTIVE.
  await activatePractice(platform, names.practiceId);
  state.practice = provisionedPractice(names, access, passwords.owner);
  return null;
}

/**
 * `medibooker-db provision <practiceId> --market <CC> [--cluster <id>]` (ADR 0005 §5.3): one JSON
 * line for the practice and a summary. Local seeding and the integration harness call it too.
 */
export async function provision(options: ProvisionOptions): Promise<ProvisionResult> {
  const start = performance.now();
  const state: RunState = { from: null, to: null, practice: undefined };
  let practiceId = options.practiceId;
  let errorCode: ErrorCode | null;
  try {
    const names = practiceNames(options.practiceId);
    practiceId = names.practiceId;
    if (!isLocalOrCi(options.appEnv) && options.markets?.includes(options.market) !== true) {
      throw new ToolError('MARKET_NOT_ALLOWED');
    }
    const store = requireSecretStore(options.secretStore);
    // Every secret this practice needs, before any database statement (02 §6).
    const defaultPasswords: RolePasswords = {
      app: await store.ensure(names.appSecretRef),
      owner: await store.ensure(names.ownerSecretRef),
    };
    errorCode = await runAudited(
      options,
      { action: 'medibooker-db.provision', practiceId: names.practiceId },
      (platform) => provisionSteps(platform, names, store, defaultPasswords, options, state),
    );
  } catch (error) {
    errorCode = toErrorCode(error);
  }
  options.output.write(practiceLine(practiceId, state.from, state.to, start, errorCode));
  options.output.write({
    command: 'provision',
    practices: 1,
    failed: errorCode === null ? 0 : 1,
    durationMs: elapsedMs(start),
    errorCode,
  });
  return {
    exitCode: errorCode === null ? 0 : 1,
    errorCode,
    practice: errorCode === null ? state.practice : undefined,
  };
}

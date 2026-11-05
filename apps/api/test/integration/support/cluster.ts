/**
 * The PostgreSQL cluster of the integration tests (02 §12, 06 §3): one Testcontainers container,
 * prepared by infra/local/postgres/init/01-cluster.sh itself, with passwords generated at run
 * time. The global setup (main process) and the test files (workers) share this module, so it
 * imports no Vitest runtime API.
 */
import { randomBytes } from 'node:crypto';
import { isIPv6 } from 'node:net';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { POSTGRES_IMAGE } from './postgres-image.js';

/**
 * The secrets of one test cluster, named like the variables of 01-cluster.sh and the root
 * .env.example. Generated per run with crypto.randomBytes; never printed or logged.
 */
export interface ClusterSecrets {
  readonly POSTGRES_PASSWORD: string;
  readonly PLATFORM_OWNER_PASSWORD: string;
  readonly PLATFORM_APP_PASSWORD: string;
  readonly PROVISIONER_PASSWORD: string;
  /** Every practice password of the development secret store derives from it. */
  readonly DEV_SECRET_SEED: string;
}

export function generateClusterSecrets(): ClusterSecrets {
  const secret = (): string => randomBytes(32).toString('base64url');
  return {
    POSTGRES_PASSWORD: secret(),
    PLATFORM_OWNER_PASSWORD: secret(),
    PLATFORM_APP_PASSWORD: secret(),
    PROVISIONER_PASSWORD: secret(),
    DEV_SECRET_SEED: secret(),
  };
}

/** What the global setup hands to every test file through Vitest's provide and inject. */
export interface IntegrationCluster {
  /** The container, whose output is the server log (server-log.ts). */
  readonly containerId: string;
  /** Where the tests reach the cluster: Testcontainers' host and the mapped port. */
  readonly host: string;
  readonly port: number;
  readonly secrets: ClusterSecrets;
}

declare module 'vitest' {
  export interface ProvidedContext {
    integrationCluster: IntegrationCluster;
  }
}

/** The migrated templates of the per-file databases and the copies the drift spec compares. */
export const PLATFORM_TEMPLATE = 'platform_template';
export const PLATFORM_DRIFT = 'platform_drift';
export const PRACTICE_DRIFT = 'practice_drift';

/** The platform database 01-cluster.sh creates; only tenancy/provisioning.int-spec.ts uses it. */
export const CLUSTER_PLATFORM_DATABASE = 'medibooker_platform';

/** The cluster's login roles: the superuser and the three roles of 01-cluster.sh. */
export type ClusterRole = 'postgres' | 'platform_owner' | 'platform_app' | 'medibooker_provisioner';

const PASSWORD_OF: Readonly<Record<ClusterRole, keyof ClusterSecrets>> = {
  postgres: 'POSTGRES_PASSWORD',
  platform_owner: 'PLATFORM_OWNER_PASSWORD',
  platform_app: 'PLATFORM_APP_PASSWORD',
  medibooker_provisioner: 'PROVISIONER_PASSWORD',
};

/** A `postgresql://` URL of a database on the cluster. It holds a password: never print it. */
export function databaseUrl(
  cluster: Pick<IntegrationCluster, 'host' | 'port'>,
  credentials: { readonly user: string; readonly password: string },
  database: string,
): string {
  const host = isIPv6(cluster.host) ? `[${cluster.host}]` : cluster.host;
  const url = new URL(`postgresql://${host}:${String(cluster.port)}`);
  url.username = credentials.user;
  url.password = credentials.password;
  url.pathname = `/${database}`;
  return url.toString();
}

/** The URL of a cluster role on a database, for example platform_owner on platform_template. */
export function roleUrl(
  cluster: Pick<IntegrationCluster, 'host' | 'port' | 'secrets'>,
  role: ClusterRole,
  database: string,
): string {
  return databaseUrl(
    cluster,
    { user: role, password: cluster.secrets[PASSWORD_OF[role]] },
    database,
  );
}

/** 01-cluster.sh: the image's entrypoint runs it once on the empty data directory, as compose. */
export const CLUSTER_INIT_SCRIPT = fileURLToPath(
  new URL('../../../../../infra/local/postgres/init/01-cluster.sh', import.meta.url),
);

/**
 * The server settings (02 §12): the log settings of ADR 0005 §4.10, every statement logged so
 * that the log checks see it, and no durability, because the data is disposable.
 */
export const SERVER_SETTINGS: readonly string[] = [
  'max_connections=300',
  'log_error_verbosity=terse',
  'log_parameter_max_length=0',
  'log_parameter_max_length_on_error=0',
  'log_statement=all',
  'fsync=off',
  'synchronous_commit=off',
  'full_page_writes=off',
];

/**
 * A configured, not yet started test cluster: the pinned image, the server settings, 01-cluster.sh
 * with the generated passwords, and the data directory on tmpfs. A test that needs a cluster of
 * its own (the TLS spec) adds its options before it starts the container.
 */
export function clusterContainer(secrets: ClusterSecrets): PostgreSqlContainer {
  return (
    new PostgreSqlContainer(POSTGRES_IMAGE)
      .withUsername('postgres')
      .withDatabase('postgres')
      .withPassword(secrets.POSTGRES_PASSWORD)
      .withEnvironment({
        PLATFORM_OWNER_PASSWORD: secrets.PLATFORM_OWNER_PASSWORD,
        PLATFORM_APP_PASSWORD: secrets.PLATFORM_APP_PASSWORD,
        PROVISIONER_PASSWORD: secrets.PROVISIONER_PASSWORD,
      })
      .withCommand(['postgres', ...SERVER_SETTINGS.flatMap((setting) => ['-c', setting])])
      .withCopyFilesToContainer([
        {
          source: CLUSTER_INIT_SCRIPT,
          target: '/docker-entrypoint-initdb.d/01-cluster.sh',
          mode: 0o755,
        },
      ])
      // The image's volume (PostgreSQL 18 keeps PGDATA below it): no anonymous volume is left
      // behind, and the cluster lives in memory.
      .withTmpFs({ '/var/lib/postgresql': 'rw' })
  );
}

/**
 * TLS between the API and a practice's cluster (ADR 0005 §4.9, §11.11; 02 §5 item 3). The spec
 * starts a cluster of its own: POSTGRES_IMAGE prepared by 01-cluster.sh like every test cluster,
 * with ssl=on, log_connections=on and a server certificate that a CA generated at run time signed
 * for the host the tests reach it under. Its platform database is migrated, one practice is
 * provisioned on the full path, and then its cluster row is switched to VERIFY_FULL with a CA
 * reference that the tests' secret stores resolve. Staging requires TLS, so the staging market
 * case runs here too (ADR 0005 §7.2).
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDevSecretStore,
  DEFAULT_MIGRATION_TIMEOUT_MS,
  DEFAULT_PRISMA_ROOT,
  migrate,
  practiceNames,
  type OutputLine,
} from '@medibooker/db-migrate';
import { provisionPractice } from '@medibooker/db-migrate/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { getContainerRuntimeClient } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DevSecretStore, SecretStore } from '../../../src/common/database/secret-store.js';
import { PRACTICE_SCHEMA_REQUIRED } from '../../../src/generated/schema-versions.js';
import type { ProviderOverride } from '../../support/create-test-app.js';
import { captureLogs } from '../../support/log-capture.js';
import { readContainerLog } from '../probes/container-log.js';
import {
  reasonCodesOf,
  requestIdentity,
  served,
  UNAVAILABLE,
  useProbeApps,
} from '../probes/probe-app.js';
import { changeRegistry } from '../probes/registry.js';
import { serverLogThroughNow } from '../probes/server-log-barrier.js';
import {
  createCertificateAuthority,
  createServerCertificate,
  type CertificateAuthority,
} from '../probes/test-certificates.js';
import {
  CLUSTER_PLATFORM_DATABASE,
  clusterContainer,
  generateClusterSecrets,
  roleUrl,
  SERVER_SETTINGS,
  type IntegrationCluster,
} from '../support/cluster.js';
import { withClient } from '../support/sql.js';

/** The cluster's CA reference; medibooker-db's development store reads it from its environment. */
const CA_REFERENCE = 'env:TLS_CLUSTER_CA';

/** The operator principal of this spec's own audit rows: synthetic, never an OS user. */
const ACTOR = 'local:integration-tls';

/** A schema version older than every build's: migration names start with their timestamp. */
const OLDER_SCHEMA_VERSION = '20260101000000_older_schema';

/** The API's development store plus the cluster's CA, as OPS01's provider will hold both. */
class ClusterSecretStore extends SecretStore {
  constructor(
    private readonly development: DevSecretStore,
    private readonly ca: string,
  ) {
    super();
  }

  get(reference: string): Promise<string> {
    return reference === CA_REFERENCE ? Promise.resolve(this.ca) : this.development.get(reference);
  }
}

describe('TLS to the practice databases (ADR 0005 §4.9, §11.11)', () => {
  const secrets = generateClusterSecrets();
  const practiceId = randomUUID();
  const { appRole } = practiceNames(practiceId);
  /** Holds the server's certificate and key and the CA file of the staging URL. */
  let directory: string | undefined;
  let container: StartedPostgreSqlContainer | undefined;
  let cluster: Pick<IntegrationCluster, 'host' | 'port' | 'secrets'>;
  /** It signed the server certificate. */
  let authority: CertificateAuthority;
  /** It did not. */
  let otherAuthority: CertificateAuthority;

  const startApp = useProbeApps(() => ({
    APP_ENV: 'ci',
    PLATFORM_DATABASE_URL: roleUrl(cluster, 'platform_app', CLUSTER_PLATFORM_DATABASE),
    SECRET_STORE: 'dev',
    DEV_SECRET_SEED: secrets.DEV_SECRET_SEED,
  }));

  function platformOwnerUrl(): string {
    return roleUrl(cluster, 'platform_owner', CLUSTER_PLATFORM_DATABASE);
  }

  function superuserUrl(): string {
    return roleUrl(cluster, 'postgres', 'postgres');
  }

  function readTlsServerLog(): Promise<string> {
    if (container === undefined) throw new Error('the TLS cluster is not running');
    return readContainerLog(container.getId());
  }

  function caFile(): string {
    if (directory === undefined) throw new Error('the certificate directory does not exist');
    return path.join(directory, 'ca.pem');
  }

  /** A SecretStore override for an API test app that trusts `trusted` as the cluster's CA. */
  function trusting(trusted: CertificateAuthority): ProviderOverride {
    const development = new DevSecretStore(secrets.DEV_SECRET_SEED);
    return { provide: SecretStore, useValue: new ClusterSecretStore(development, trusted.pem) };
  }

  /**
   * `medibooker-db migrate` on this cluster, as the CLI runs it, with a development store that
   * resolves the cluster's CA reference to `ca`: its exit code and its JSON lines.
   */
  async function runMigrate(
    target: 'platform' | 'practices',
    ca: CertificateAuthority,
  ): Promise<{ exitCode: number; lines: OutputLine[] }> {
    const lines: OutputLine[] = [];
    const exitCode = await migrate({
      target,
      practiceId: target === 'practices' ? practiceId : undefined,
      appEnv: 'ci',
      platformUrl: platformOwnerUrl(),
      actor: ACTOR,
      output: {
        write: (line) => {
          lines.push(line);
        },
      },
      secretStore: createDevSecretStore({
        appEnv: 'ci',
        seed: secrets.DEV_SECRET_SEED,
        environment: { TLS_CLUSTER_CA: ca.pem },
      }),
      prismaRoot: DEFAULT_PRISMA_ROOT,
      clusterEndpoints: new Map(),
      concurrency: 1,
      timeoutMs: DEFAULT_MIGRATION_TIMEOUT_MS,
      lockRetries: 0,
    });
    return { exitCode, lines };
  }

  beforeAll(async () => {
    // The host Testcontainers will report for the container: the certificate is made for it.
    const { host } = (await getContainerRuntimeClient()).info.containerRuntime;
    authority = await createCertificateAuthority('MediBooker test CA');
    otherAuthority = await createCertificateAuthority('MediBooker other CA');
    const server = await createServerCertificate(authority, host);
    directory = await mkdtemp(path.join(tmpdir(), 'medibooker-tls-'));
    const certificateFile = path.join(directory, 'server.crt');
    const keyFile = path.join(directory, 'server.key');
    await writeFile(certificateFile, server.certificatePem);
    await writeFile(keyFile, server.privateKeyPem, { mode: 0o600 });
    await writeFile(caFile(), authority.pem);
    const settings = [...SERVER_SETTINGS, 'log_connections=on'];
    // withSSL hands the key to the server's user before the image's entrypoint runs.
    const started = await clusterContainer(secrets)
      .withCommand(['postgres', ...settings.flatMap((setting) => ['-c', setting])])
      .withSSL(certificateFile, keyFile)
      .start();
    container = started;
    cluster = { host: started.getHost(), port: started.getPort(), secrets };
    if (cluster.host !== host)
      throw new Error('the container is not reached under its certificate host');
    const platform = await runMigrate('platform', authority);
    if (platform.exitCode !== 0) throw new Error('migrate platform failed on the TLS cluster');
    // Provisioned on the full path while the cluster is still registered without TLS.
    const provisionerUrl = roleUrl(cluster, 'medibooker_provisioner', 'postgres');
    await provisionPractice({
      practiceId,
      market: 'SA',
      appEnv: 'ci',
      platformUrl: platformOwnerUrl(),
      provisionerUrl,
      actor: ACTOR,
      secretStore: createDevSecretStore({
        appEnv: 'ci',
        seed: secrets.DEV_SECRET_SEED,
        environment: { PROVISIONER_DATABASE_URL: provisionerUrl },
      }),
    });
    await withClient(platformOwnerUrl(), (owner) =>
      owner.query("UPDATE database_clusters SET tls_mode = 'VERIFY_FULL', ca_secret_ref = $1", [
        CA_REFERENCE,
      ]),
    );
  });

  afterAll(async () => {
    await container?.stop();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it('ADR-0005 §4.9 a practice client with the right CA connects with verify-full', async () => {
    const app = await startApp({ overrides: [trusting(authority)] });
    expect(await requestIdentity(app, practiceId)).toEqual(served(practiceId));
    const sessions = await withClient(superuserUrl(), (admin) =>
      admin.query<{ ssl: boolean }>(
        `SELECT s.ssl FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid)
         WHERE a.usename = $1`,
        [appRole],
      ),
    );
    expect([...new Set(sessions.rows.map((session) => session.ssl))]).toEqual([true]);
    // The control of the next test: an accepted client's role is named in the server log.
    const log = await serverLogThroughNow(readTlsServerLog, superuserUrl());
    expect(
      log
        .split('\n')
        .some(
          (line) =>
            line.includes(`connection authorized: user=${appRole} `) &&
            line.includes('SSL enabled'),
        ),
    ).toBe(true);
  });

  it('ADR-0005 §11.11 with a CA that did not sign the server certificate the probe answers 503 and the server log shows no authentication attempt for the app role', async () => {
    const logs = captureLogs();
    const logBefore = (await readTlsServerLog()).length;
    const app = await startApp({ overrides: [trusting(otherAuthority)], logDestination: logs });
    expect(await requestIdentity(app, practiceId)).toEqual(UNAVAILABLE);
    expect(reasonCodesOf(logs, practiceId)).toEqual(['PRACTICE_CONNECTION_FAILED']);
    const attempt = (await serverLogThroughNow(readTlsServerLog, superuserUrl())).slice(logBefore);
    // The handshake reached the server and failed there; no startup message named the role.
    expect({
      handshakeFailed: attempt.includes('could not accept SSL connection'),
      appRoleNamed: attempt.includes(appRole),
    }).toEqual({ handshakeFailed: true, appRoleNamed: false });
  });

  it("ADR-0005 §11.11 the runner's Prisma URL with a wrong CA fails with DATABASE_TLS_FAILED, and with the right CA it migrates", async () => {
    // The runner deploys only to practices behind the newest migration.
    await changeRegistry(platformOwnerUrl(), practiceId, { schemaVersion: OLDER_SCHEMA_VERSION });
    try {
      const practiceLines = (run: { lines: OutputLine[] }): unknown[] =>
        run.lines.flatMap((line) =>
          'practiceId' in line ? [{ practiceId: line.practiceId, errorCode: line.errorCode }] : [],
        );
      const wrong = await runMigrate('practices', otherAuthority);
      const right = await runMigrate('practices', authority);
      expect({
        wrong: { exitCode: wrong.exitCode, practices: practiceLines(wrong) },
        right: { exitCode: right.exitCode, practices: practiceLines(right) },
      }).toEqual({
        wrong: { exitCode: 1, practices: [{ practiceId, errorCode: 'DATABASE_TLS_FAILED' }] },
        right: { exitCode: 0, practices: [{ practiceId, errorCode: null }] },
      });
    } finally {
      await changeRegistry(platformOwnerUrl(), practiceId, {
        schemaVersion: PRACTICE_SCHEMA_REQUIRED,
      });
    }
  });

  it('ADR-0005 §7.2 under APP_ENV=staging a practice with market XX answers 503 while /health/ready stays 200', async () => {
    const logs = captureLogs();
    const platformUrl = new URL(roleUrl(cluster, 'platform_app', CLUSTER_PLATFORM_DATABASE));
    platformUrl.searchParams.set('sslmode', 'verify-full');
    platformUrl.searchParams.set('sslrootcert', caFile());
    const app = await startApp({
      env: {
        NODE_ENV: 'production',
        APP_ENV: 'staging',
        TRUST_PROXY_HOPS: '1',
        RATE_LIMIT_PER_MINUTE: '1000',
        MARKETS: 'SA',
        PUBLIC_WEB_URL: 'https://web.example.test',
        PRACTICE_SLUG: 'al-noor',
        AUTH_SIGNING_KEY_REFS: 'hosted:auth-signing-key',
        AUTH_SECRET_REF: 'hosted:auth-secret',
        FIELD_ENCRYPTION_KEY_REFS: 'hosted:field-encryption-key',
        BLIND_INDEX_KEY_REF: 'hosted:blind-index-key',
        PLATFORM_DATABASE_URL: platformUrl.toString(),
        // Blank is unset, as staging requires; the overridden SecretStore resolves the references.
        SECRET_STORE: '',
        DEV_SECRET_SEED: '',
      },
      overrides: [trusting(authority)],
      logDestination: logs,
    });
    // The control: in a market of MARKETS, staging serves the practice over verify-full TLS.
    expect(await requestIdentity(app, practiceId)).toEqual(served(practiceId));
    await changeRegistry(platformOwnerUrl(), practiceId, { market: 'XX' });
    try {
      const practice = await requestIdentity(app, practiceId);
      const ready = await request(app.getHttpServer()).get('/health/ready');
      expect({
        practice,
        reasonCodes: reasonCodesOf(logs, practiceId),
        ready: { status: ready.status, body: ready.text },
      }).toEqual({
        practice: UNAVAILABLE,
        reasonCodes: ['PRACTICE_MARKET_NOT_SERVED'],
        ready: { status: 200, body: '{"status":"ok"}' },
      });
    } finally {
      await changeRegistry(platformOwnerUrl(), practiceId, { market: 'SA' });
    }
  });
});

import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { describe, expect, it, vi } from 'vitest';
import { fakePinoLogger } from '../../../test/support/fake-pino-logger.js';
import { PRACTICE_A, PRACTICE_B, practiceRoute } from '../../../test/support/practice-routes.js';
import { TEST_ENV } from '../../../test/support/test-env.js';
import { type Env, parseEnv } from '../../config/env.schema.js';
import type { PlatformPrismaService } from '../database/platform-prisma.service.js';
import { SecretUnavailableError } from '../database/secret-store.js';
import { FixedClock } from '../time/fixed-clock.js';
import type {
  PracticeClient,
  PracticeClientFactory,
  PracticeConnection,
} from './practice-client.js';
import { PracticeClientOpener } from './practice-client-opener.js';
import { PracticeConnectionMetrics } from './practice-connection-metrics.js';
import { PracticeSecrets } from './practice-secrets.js';

const CA = '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----\n';
const ROUTE = practiceRoute(PRACTICE_A);
const ID32 = '0000000000004000800000000000000a';

interface ClusterRow {
  id: string;
  host: string;
  port: number;
  tlsMode: 'DISABLE' | 'VERIFY_FULL';
  caSecretRef: string | null;
}

const LOCAL_CLUSTER: ClusterRow = {
  id: 'local',
  host: 'db.internal.test',
  port: 5432,
  tlsMode: 'DISABLE',
  caSecretRef: null,
};

/** What the first query of a client answers: an identity row, or an error. */
type FirstQuery = { practice_id: string | null; public_connect: boolean } | Error;

interface FakeClient {
  readonly connection: PracticeConnection;
  readonly $disconnect: ReturnType<typeof vi.fn>;
}

/** A Prisma error with the driver adapter's report, as the pg adapter produces it. */
function driverError(kind: string, originalCode?: string): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('Invalid invocation: example-secret-value', {
    code: 'P2010',
    clientVersion: '7.10.1',
    meta: { driverAdapterError: { name: 'DriverAdapterError', cause: { kind, originalCode } } },
  });
}

function setUp({
  cluster = LOCAL_CLUSTER,
  env = parseEnv(TEST_ENV),
  firstQueries = [{ practice_id: PRACTICE_A, public_connect: false }],
  secret = (reference: string): Promise<string> => Promise.resolve(`example-${reference}`),
}: {
  cluster?: ClusterRow | null;
  env?: Env;
  firstQueries?: FirstQuery[];
  secret?: (reference: string) => Promise<string>;
} = {}) {
  const clients: FakeClient[] = [];
  const answers = [...firstQueries];
  const factory = {
    create: vi.fn((_practiceId: string, connection: PracticeConnection) => {
      const answer = answers.shift() ?? new Error('no answer prepared');
      const client = {
        connection,
        $disconnect: vi.fn().mockResolvedValue(undefined),
        $queryRaw: vi.fn(() =>
          answer instanceof Error ? Promise.reject(answer) : Promise.resolve([answer]),
        ),
      };
      clients.push(client);
      return client as unknown as PracticeClient;
    }),
  };
  const store = { get: vi.fn(secret) };
  const platform = {
    databaseCluster: { findUnique: vi.fn().mockResolvedValue(cluster) },
  } as unknown as PlatformPrismaService;
  const clock = new FixedClock(Temporal.Instant.from('2026-11-16T05:00:00Z'));
  const secrets = new PracticeSecrets(store, clock, env);
  const metrics = new PracticeConnectionMetrics();
  const { logger, calls } = fakePinoLogger();
  const opener = new PracticeClientOpener(
    env,
    platform,
    secrets,
    store,
    factory as unknown as PracticeClientFactory,
    metrics,
    logger,
  );
  return { opener, factory, clients, store, metrics, calls, platform };
}

const STAGING = parseEnv({
  ...TEST_ENV,
  APP_ENV: 'staging',
  NODE_ENV: 'production',
  TRUST_PROXY_HOPS: '1',
  RATE_LIMIT_PER_MINUTE: '120',
  SECRET_STORE: '',
  PLATFORM_DATABASE_URL:
    'postgresql://platform_app:pw@db.internal.test:5432/medibooker_platform?sslmode=verify-full&sslrootcert=/ca.pem',
  MARKETS: 'SA',
  PUBLIC_WEB_URL: 'https://web.example.test',
  PRACTICE_SLUG: 'al-noor',
  AUTH_SIGNING_KEY_REFS: 'hosted:auth-signing-key',
  AUTH_SECRET_REF: 'hosted:auth-secret',
  FIELD_ENCRYPTION_KEY_REFS: 'hosted:field-encryption-key',
  BLIND_INDEX_KEY_REF: 'hosted:blind-index-key',
});

describe('PracticeClientOpener (02 §5 item 3)', () => {
  it("connects as the routed database's app role with the password from the secret store", async () => {
    const { opener, factory, store } = setUp();
    await opener.open(ROUTE);
    expect(store.get).toHaveBeenCalledWith(`dev:practice_${ID32}_app`);
    expect(factory.create).toHaveBeenCalledWith(PRACTICE_A, {
      host: 'db.internal.test',
      port: 5432,
      database: `practice_${ID32}`,
      user: `practice_${ID32}_app`,
      password: `example-dev:practice_${ID32}_app`,
      ssl: false,
      poolMax: 3,
    });
  });

  it('takes host and port from DATABASE_CLUSTER_ENDPOINTS in local and ci', async () => {
    const env = parseEnv({ ...TEST_ENV, DATABASE_CLUSTER_ENDPOINTS: '{"local":"127.0.0.1:6543"}' });
    const { opener, clients } = setUp({ env });
    await opener.open(ROUTE);
    expect(clients[0]?.connection).toMatchObject({ host: '127.0.0.1', port: 6543 });
  });

  it('refuses a cluster that is not registered', async () => {
    const { opener, factory } = setUp({ cluster: null });
    await expect(opener.open(ROUTE)).rejects.toMatchObject({ reason: 'PRACTICE_CLUSTER_UNKNOWN' });
    expect(factory.create).not.toHaveBeenCalled();
  });

  describe('TLS per tls_mode (ADR 0005 §4.9)', () => {
    it('connects without TLS to a DISABLE cluster in local and ci only', async () => {
      const local = setUp({ env: parseEnv({ ...TEST_ENV, APP_ENV: 'local' }) });
      await local.opener.open(ROUTE);
      expect(local.clients[0]?.connection.ssl).toBe(false);
      const staging = setUp({ env: STAGING });
      await expect(staging.opener.open(ROUTE)).rejects.toMatchObject({
        reason: 'PRACTICE_TLS_REQUIRED',
      });
      expect(staging.factory.create).not.toHaveBeenCalled();
    });

    it("verifies a VERIFY_FULL cluster's certificate against its CA and its host name", async () => {
      const cluster: ClusterRow = {
        ...LOCAL_CLUSTER,
        tlsMode: 'VERIFY_FULL',
        caSecretRef: 'dev:ca-local',
      };
      const { opener, clients, store } = setUp({
        env: STAGING,
        cluster,
        secret: (reference) => Promise.resolve(reference === 'dev:ca-local' ? CA : 'example-pw'),
      });
      await opener.open(ROUTE);
      expect(store.get).toHaveBeenCalledWith('dev:ca-local');
      expect(clients[0]?.connection.ssl).toEqual({
        ca: CA,
        rejectUnauthorized: true,
        servername: 'db.internal.test',
      });
    });

    it('refuses a VERIFY_FULL cluster without a CA reference, or whose CA cannot be read', async () => {
      const withoutCa = setUp({ cluster: { ...LOCAL_CLUSTER, tlsMode: 'VERIFY_FULL' } });
      await expect(withoutCa.opener.open(ROUTE)).rejects.toMatchObject({
        reason: 'PRACTICE_SECRET_UNAVAILABLE',
      });
      const unreadable = setUp({
        cluster: { ...LOCAL_CLUSTER, tlsMode: 'VERIFY_FULL', caSecretRef: 'vault:ca' },
        secret: () => Promise.reject(new SecretUnavailableError()),
      });
      await expect(unreadable.opener.open(ROUTE)).rejects.toMatchObject({
        reason: 'PRACTICE_SECRET_UNAVAILABLE',
      });
      expect(unreadable.factory.create).not.toHaveBeenCalled();
    });
  });

  it('refuses a practice whose password the store cannot resolve, before it connects', async () => {
    const { opener, factory } = setUp({
      secret: () => Promise.reject(new SecretUnavailableError()),
    });
    await expect(opener.open(ROUTE)).rejects.toMatchObject({
      reason: 'PRACTICE_SECRET_UNAVAILABLE',
    });
    expect(factory.create).not.toHaveBeenCalled();
  });

  it('ADR-0005 §11.7 refuses a database whose practice_identity names another practice, closes it and logs the code', async () => {
    const { opener, clients, metrics, calls } = setUp({
      firstQueries: [{ practice_id: PRACTICE_B, public_connect: false }],
    });
    await expect(opener.open(ROUTE)).rejects.toMatchObject({
      practiceId: PRACTICE_A,
      reason: 'PRACTICE_IDENTITY_MISMATCH',
    });
    expect(clients[0]?.$disconnect).toHaveBeenCalled();
    expect(metrics.identityMismatches).toBe(1);
    expect(calls).toEqual([
      {
        level: 'error',
        fields: {
          practiceId: PRACTICE_A,
          clusterId: 'local',
          reasonCode: 'PRACTICE_IDENTITY_MISMATCH',
        },
        message: 'practice database refused',
      },
    ]);
  });

  it('refuses a database without an identity row', async () => {
    const { opener } = setUp({ firstQueries: [{ practice_id: null, public_connect: false }] });
    await expect(opener.open(ROUTE)).rejects.toMatchObject({
      reason: 'PRACTICE_IDENTITY_MISMATCH',
    });
  });

  it('ADR-0005 §11.7 refuses a database whose CONNECT is open to PUBLIC, closes it and logs the code', async () => {
    const { opener, clients, metrics, calls } = setUp({
      firstQueries: [{ practice_id: PRACTICE_A, public_connect: true }],
    });
    await expect(opener.open(ROUTE)).rejects.toMatchObject({ reason: 'PRACTICE_ACL_OPEN' });
    expect(clients[0]?.$disconnect).toHaveBeenCalled();
    expect(metrics.openAcls).toBe(1);
    expect(calls).toEqual([
      expect.objectContaining({
        fields: expect.objectContaining({ reasonCode: 'PRACTICE_ACL_OPEN' }) as unknown,
      }),
    ]);
  });

  it('reads the password again once after 28P01 and connects with the new one', async () => {
    const { opener, clients, store, metrics } = setUp({
      firstQueries: [
        driverError('AuthenticationFailed', '28P01'),
        { practice_id: PRACTICE_A, public_connect: false },
      ],
    });
    const client = await opener.open(ROUTE);
    expect(client).toBe(clients[1]);
    expect(clients[0]?.$disconnect).toHaveBeenCalled();
    expect(store.get).toHaveBeenCalledTimes(2);
    expect(metrics.authenticationFailures).toBe(1);
  });

  it('gives up after a second 28P01', async () => {
    const { opener, clients, metrics } = setUp({
      firstQueries: [
        driverError('AuthenticationFailed', '28P01'),
        driverError('AuthenticationFailed', '28P01'),
      ],
    });
    await expect(opener.open(ROUTE)).rejects.toMatchObject({
      reason: 'PRACTICE_AUTHENTICATION_FAILED',
    });
    expect(clients).toHaveLength(2);
    expect(metrics.authenticationFailures).toBe(2);
  });

  it.each([
    ['a refused connection', driverError('DatabaseNotReachable')],
    ['an unknown database', driverError('DatabaseDoesNotExist', '3D000')],
    ['a certificate that does not verify', driverError('TlsConnectionError')],
    ['a connect timeout', new Error('timeout exceeded when trying to connect')],
  ])('turns %s into PRACTICE_CONNECTION_FAILED and closes the client', async (_case, error) => {
    const { opener, clients } = setUp({ firstQueries: [error] });
    await expect(opener.open(ROUTE)).rejects.toMatchObject({
      reason: 'PRACTICE_CONNECTION_FAILED',
    });
    expect(clients[0]?.$disconnect).toHaveBeenCalled();
  });

  it('keeps the reason when closing the failed client fails too', async () => {
    const { opener, clients, factory } = setUp({ firstQueries: [driverError('ConnectionClosed')] });
    factory.create.mockImplementationOnce((_practiceId: string, connection: PracticeConnection) => {
      const client = {
        connection,
        $disconnect: vi.fn().mockRejectedValue(new Error('already closed')),
        $queryRaw: vi.fn().mockRejectedValue(driverError('ConnectionClosed')),
      };
      clients.push(client);
      return client as unknown as PracticeClient;
    });
    await expect(opener.open(ROUTE)).rejects.toMatchObject({
      reason: 'PRACTICE_CONNECTION_FAILED',
    });
  });

  it('logs no host, user, secret reference or password', async () => {
    const { opener, calls } = setUp({
      firstQueries: [{ practice_id: PRACTICE_B, public_connect: true }],
    });
    await expect(opener.open(ROUTE)).rejects.toBeDefined();
    expect(JSON.stringify(calls)).not.toMatch(/db\.internal\.test|practice_0|dev:|example-/);
  });
});

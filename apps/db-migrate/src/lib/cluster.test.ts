import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clusterAccessResolver,
  createCaFiles,
  credentialsFromUrl,
  endpointFromUrl,
  parseClusterEndpoints,
  pgConnectionConfig,
  prismaDatasourceUrl,
  resolveClusterAccess,
  type ClusterAccess,
  type ClusterRecord,
} from './cluster.ts';
import type { SecretStore } from './secret-store.ts';

const OWNER = { user: 'practice_x_owner', password: 'example-owner-pw', database: 'practice_x' };
const SYNTHETIC_CA = 'synthetic CA certificate';

const store: SecretStore = {
  get: (ref) =>
    ref === 'env:CLUSTER_CA'
      ? Promise.resolve(SYNTHETIC_CA)
      : Promise.reject(Object.assign(new Error('x'), { code: 'SECRET_UNRESOLVABLE' })),
  ensure: () => Promise.reject(new Error('not used')),
};

function cluster(overrides: Partial<ClusterRecord> = {}): ClusterRecord {
  return {
    id: 'local',
    host: '127.0.0.1',
    port: 5432,
    tlsMode: 'DISABLE',
    caSecretRef: null,
    provisionerSecretRef: 'env:PROVISIONER_DATABASE_URL',
    status: 'ACTIVE',
    ...overrides,
  };
}

const PLAIN: ClusterAccess = {
  clusterId: 'local',
  endpoint: { host: '127.0.0.1', port: 5432 },
  tls: { mode: 'disable' },
};
const VERIFIED: ClusterAccess = {
  clusterId: 'eu-1',
  endpoint: { host: 'db.eu-1.example.test', port: 6432 },
  tls: { mode: 'verify-full', ca: SYNTHETIC_CA },
};

describe('parseClusterEndpoints', () => {
  it('maps cluster ids to host and port', () => {
    const endpoints = parseClusterEndpoints('{"local":"db:5432","eu-1":"[::1]:6432"}');
    expect([...endpoints]).toEqual([
      ['local', { host: 'db', port: 5432 }],
      ['eu-1', { host: '::1', port: 6432 }],
    ]);
  });

  it.each([
    'not json',
    '[]',
    '"db:5432"',
    '{"local":5432}',
    '{"Local":"db:5432"}',
    '{"local":"db"}',
    '{"local":"db:0"}',
    '{"local":"db:70000"}',
    '{"local":"db:5432/x"}',
  ])('rejects %s', (json) => {
    expect(() => parseClusterEndpoints(json)).toThrow();
  });
});

describe('resolveClusterAccess', () => {
  it('uses the registered endpoint, or the override of DATABASE_CLUSTER_ENDPOINTS', async () => {
    const options = { appEnv: 'local' as const, secretStore: store };
    await expect(
      resolveClusterAccess(cluster(), { ...options, endpoints: new Map() }),
    ).resolves.toEqual(PLAIN);
    const endpoints = new Map([['local', { host: 'db', port: 5432 }]]);
    await expect(resolveClusterAccess(cluster(), { ...options, endpoints })).resolves.toMatchObject(
      {
        endpoint: { host: 'db', port: 5432 },
      },
    );
  });

  it.each(['staging', 'production'] as const)(
    'refuses a cluster without TLS in %s',
    async (appEnv) => {
      await expect(
        resolveClusterAccess(cluster(), { appEnv, endpoints: new Map(), secretStore: store }),
      ).rejects.toMatchObject({ code: 'CLUSTER_TLS_REQUIRED' });
    },
  );

  it("reads a VERIFY_FULL cluster's CA from its reference, in every environment", async () => {
    const verifyFull = cluster({ tlsMode: 'VERIFY_FULL', caSecretRef: 'env:CLUSTER_CA' });
    for (const appEnv of ['local', 'production'] as const) {
      await expect(
        resolveClusterAccess(verifyFull, { appEnv, endpoints: new Map(), secretStore: store }),
      ).resolves.toMatchObject({ tls: { mode: 'verify-full', ca: SYNTHETIC_CA } });
    }
    await expect(
      resolveClusterAccess(cluster({ tlsMode: 'VERIFY_FULL' }), {
        appEnv: 'local',
        endpoints: new Map(),
        secretStore: store,
      }),
    ).rejects.toMatchObject({ code: 'SECRET_UNRESOLVABLE' });
  });
});

describe('clusterAccessResolver', () => {
  it('resolves each cluster once and refuses an unknown one', async () => {
    let reads = 0;
    const counting: SecretStore = {
      get: () => {
        reads += 1;
        return Promise.resolve(SYNTHETIC_CA);
      },
      ensure: () => Promise.reject(new Error('not used')),
    };
    const accessOf = clusterAccessResolver(
      [cluster({ id: 'eu-1', tlsMode: 'VERIFY_FULL', caSecretRef: 'env:CLUSTER_CA' })],
      { appEnv: 'ci', endpoints: new Map(), secretStore: counting },
    );
    await Promise.all([accessOf('eu-1'), accessOf('eu-1')]);
    expect(reads).toBe(1);
    await expect(accessOf('missing')).rejects.toMatchObject({ code: 'CLUSTER_NOT_FOUND' });
    await expect(accessOf(null)).rejects.toMatchObject({ code: 'CLUSTER_NOT_FOUND' });
  });
});

describe('pgConnectionConfig', () => {
  it('connects without TLS only to a DISABLE cluster', () => {
    expect(pgConnectionConfig(PLAIN, OWNER, 'medibooker-db')).toEqual({
      host: '127.0.0.1',
      port: 5432,
      user: 'practice_x_owner',
      password: 'example-owner-pw',
      database: 'practice_x',
      application_name: 'medibooker-db',
      connectionTimeoutMillis: 10_000,
      ssl: false,
    });
  });

  it("verifies a VERIFY_FULL cluster's certificate against its CA and host name", () => {
    expect(pgConnectionConfig(VERIFIED, OWNER, 'medibooker-db').ssl).toEqual({
      ca: SYNTHETIC_CA,
      rejectUnauthorized: true,
      servername: 'db.eu-1.example.test',
    });
  });

  it('sends no IP address as the TLS server name (RFC 6066); the IP is verified instead', () => {
    const byIp: ClusterAccess = { ...VERIFIED, endpoint: { host: '10.0.0.7', port: 5432 } };
    expect(pgConnectionConfig(byIp, OWNER, 'medibooker-db').ssl).toEqual({
      ca: SYNTHETIC_CA,
      rejectUnauthorized: true,
    });
  });
});

describe('prismaDatasourceUrl', () => {
  it('says sslmode=disable for a DISABLE cluster', () => {
    expect(
      prismaDatasourceUrl(PLAIN, OWNER, {
        applicationName: 'medibooker-migrate',
        caFile: undefined,
      }),
    ).toBe(
      'postgresql://practice_x_owner:example-owner-pw@127.0.0.1:5432/practice_x?application_name=medibooker-migrate&sslmode=disable',
    );
  });

  it('requires TLS with the CA file and strict verification for VERIFY_FULL', () => {
    const url = new URL(
      prismaDatasourceUrl(VERIFIED, OWNER, {
        applicationName: 'medibooker-migrate',
        caFile: 'C:\\Temp dir\\medibooker-db-1\\eu-1.pem',
      }),
    );
    expect(url.host).toBe('db.eu-1.example.test:6432');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      application_name: 'medibooker-migrate',
      sslmode: 'require',
      sslcert: 'C:\\Temp dir\\medibooker-db-1\\eu-1.pem',
      sslaccept: 'strict',
    });
    expect(() =>
      prismaDatasourceUrl(VERIFIED, OWNER, { applicationName: 'x', caFile: undefined }),
    ).toThrow(TypeError);
  });

  it('encodes credentials and brackets an IPv6 host', () => {
    const access: ClusterAccess = { ...PLAIN, endpoint: { host: '::1', port: 5432 } };
    const url = prismaDatasourceUrl(
      access,
      { user: 'a@b', password: 'p:/?#example', database: 'practice_x' },
      { applicationName: 'medibooker-migrate', caFile: undefined },
    );
    expect(url.startsWith('postgresql://a%40b:p%3A%2F%3F%23example@[::1]:5432/practice_x?')).toBe(
      true,
    );
  });
});

describe('credentialsFromUrl and endpointFromUrl', () => {
  it('read user, password, database, host and port', () => {
    const url = 'postgresql://medibooker_provisioner:changeme-provisioner@127.0.0.1:5433/postgres';
    expect(credentialsFromUrl(url)).toEqual({
      user: 'medibooker_provisioner',
      password: 'changeme-provisioner',
      database: 'postgres',
    });
    expect(endpointFromUrl(url)).toEqual({ host: '127.0.0.1', port: 5433 });
  });

  it('defaults the database and the port, and unbrackets IPv6', () => {
    expect(credentialsFromUrl('postgresql://u@[::1]').database).toBe('postgres');
    expect(endpointFromUrl('postgresql://u@[::1]')).toEqual({ host: '::1', port: 5432 });
  });

  it('refuses a malformed value without repeating it', () => {
    expect(() => credentialsFromUrl('changeme not a url')).toThrow(
      expect.objectContaining({ code: 'SECRET_UNRESOLVABLE', message: 'SECRET_UNRESOLVABLE' }),
    );
  });
});

describe('createCaFiles', () => {
  it('writes one file per VERIFY_FULL cluster and removes them all', async () => {
    const caFiles = createCaFiles();
    await expect(caFiles.pathFor(PLAIN)).resolves.toBeUndefined();
    const [first, second] = await Promise.all([
      caFiles.pathFor(VERIFIED),
      caFiles.pathFor(VERIFIED),
    ]);
    expect(first).toBe(second);
    expect(readFileSync(first ?? '', 'utf8')).toBe(SYNTHETIC_CA);
    await caFiles.dispose();
    expect(existsSync(first ?? '')).toBe(false);
  });

  it('disposes without having written anything', async () => {
    await expect(createCaFiles().dispose()).resolves.toBeUndefined();
  });
});

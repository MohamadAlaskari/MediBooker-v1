import { describe, expect, it } from 'vitest';
import { appRoleOf, endpointOf, tlsOptionsOf } from './practice-endpoint.js';

const CLUSTER = { id: 'local', host: 'db.internal.test', port: 5432 };
const CA = '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----\n';

describe('endpointOf (02 §5 item 1)', () => {
  it("takes the cluster's registered host and port", () => {
    expect(endpointOf(CLUSTER, new Map())).toEqual({ host: 'db.internal.test', port: 5432 });
  });

  it('takes the DATABASE_CLUSTER_ENDPOINTS override of the same cluster', () => {
    const overrides = new Map([
      ['local', { host: '127.0.0.1', port: 6543 }],
      ['other', { host: 'db', port: 5432 }],
    ]);
    expect(endpointOf(CLUSTER, overrides)).toEqual({ host: '127.0.0.1', port: 6543 });
    expect(endpointOf({ ...CLUSTER, id: 'eu-central-1' }, overrides)).toEqual({
      host: 'db.internal.test',
      port: 5432,
    });
  });
});

describe('tlsOptionsOf (ADR 0005 §4.9, tls_mode VERIFY_FULL)', () => {
  it("trusts only the cluster's CA, verifies the certificate and checks the host name", () => {
    expect(tlsOptionsOf(CA, 'db.internal.test')).toEqual({
      ca: CA,
      rejectUnauthorized: true,
      servername: 'db.internal.test',
    });
  });

  it.each(['127.0.0.1', '::1'])(
    'sends no server name for the IP address %s; Node checks the address against the certificate',
    (host) => {
      expect(tlsOptionsOf(CA, host)).toEqual({ ca: CA, rejectUnauthorized: true });
    },
  );
});

describe('appRoleOf (02 §6)', () => {
  it("names the routed database's app role", () => {
    expect(appRoleOf({ databaseName: 'practice_0000000000004000800000000000000a' })).toBe(
      'practice_0000000000004000800000000000000a_app',
    );
  });
});

import { isIP } from 'node:net';
import type { ConnectionOptions } from 'node:tls';
import type { ClusterEndpoint } from '../../config/env.schema.js';
import type { PracticeRoute } from './practice-route.js';

/**
 * Where the API reaches a cluster (02 §5 item 1): its registered host and port, unless
 * DATABASE_CLUSTER_ENDPOINTS (local and ci only) overrides them, so host processes and compose
 * containers reach the same cluster under different addresses.
 */
export function endpointOf(
  cluster: { readonly id: string; readonly host: string; readonly port: number },
  overrides: ReadonlyMap<string, ClusterEndpoint>,
): ClusterEndpoint {
  return overrides.get(cluster.id) ?? { host: cluster.host, port: cluster.port };
}

/**
 * The TLS options of a practice client (ADR 0005 §4.9): only the cluster's CA is trusted, the
 * certificate must verify, and its name must match the host. Node checks the name against
 * `servername`, or against the host when `servername` is unset; an IP address must not be sent as
 * a server name (RFC 6066), so for one the check against the host remains.
 */
export function tlsOptionsOf(ca: string, host: string): ConnectionOptions {
  return { ca, rejectUnauthorized: true, ...(isIP(host) === 0 ? { servername: host } : {}) };
}

/**
 * The app role of a practice database: `practice_<id32>_app` for `practice_<id32>` (02 §6). It
 * is derived from the routed database, so a route that points at another practice's database
 * connects as that database's role and the identity check refuses it.
 */
export function appRoleOf(route: Pick<PracticeRoute, 'databaseName'>): string {
  return `${route.databaseName}_app`;
}

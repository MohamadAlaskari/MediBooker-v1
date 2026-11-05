import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ClientConfig } from 'pg';
import { isLocalOrCi, type AppEnv } from './app-env.ts';
import { ToolError } from './errors.ts';
import type { SecretStore } from './secret-store.ts';

export interface Endpoint {
  readonly host: string;
  readonly port: number;
}

/** DATABASE_CLUSTER_ENDPOINTS: host and port per cluster id, accepted only in local and ci. */
export type ClusterEndpoints = ReadonlyMap<string, Endpoint>;

export type TlsMode = 'DISABLE' | 'VERIFY_FULL';

/** A row of database_clusters as the tools read it. Host, port and references are never logged. */
export interface ClusterRecord {
  readonly id: string;
  readonly host: string;
  readonly port: number;
  readonly tlsMode: TlsMode;
  readonly caSecretRef: string | null;
  readonly provisionerSecretRef: string | null;
  readonly status: 'ACTIVE' | 'DISABLED';
}

export type ClusterTls =
  { readonly mode: 'disable' } | { readonly mode: 'verify-full'; readonly ca: string };

/** How the tools reach one cluster: the endpoint after the override, and its TLS settings. */
export interface ClusterAccess {
  readonly clusterId: string;
  readonly endpoint: Endpoint;
  readonly tls: ClusterTls;
}

export interface Credentials {
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

/** Every tool connection gives up after this long instead of hanging on an unreachable host. */
export const CONNECT_TIMEOUT_MS = 10_000;

const CLUSTER_ID = /^[a-z][a-z0-9-]{0,39}$/;
const HOST_PORT = /^(?:\[([0-9A-Fa-f:.]+)\]|([A-Za-z0-9.-]+)):(\d{1,5})$/;

export function isClusterId(value: string): boolean {
  return CLUSTER_ID.test(value);
}

function parseHostPort(value: string): Endpoint {
  const match = HOST_PORT.exec(value);
  const host = match?.[1] ?? match?.[2];
  const port = Number(match?.[3]);
  if (host === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('expected host:port');
  }
  return { host, port };
}

/**
 * Parses DATABASE_CLUSTER_ENDPOINTS, a JSON object from cluster id to `host:port`, for example
 * `{"local":"db:5432"}`: host processes and compose containers reach one cluster under two
 * addresses (07 §2). Throws a TypeError without the value; the caller reports the key.
 */
export function parseClusterEndpoints(json: string): ClusterEndpoints {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('expected a JSON object');
  }
  const endpoints = new Map<string, Endpoint>();
  for (const [id, value] of Object.entries(parsed)) {
    if (!isClusterId(id) || typeof value !== 'string') {
      throw new TypeError('expected cluster ids mapped to host:port');
    }
    endpoints.set(id, parseHostPort(value));
  }
  return endpoints;
}

export interface ClusterAccessOptions {
  readonly appEnv: AppEnv;
  readonly endpoints: ClusterEndpoints;
  readonly secretStore: SecretStore;
}

/**
 * The endpoint and TLS settings of a cluster. A cluster without TLS is accepted only in local and
 * ci (ADR 0005 §4.9); a VERIFY_FULL cluster's CA comes from its `ca_secret_ref`.
 */
export async function resolveClusterAccess(
  cluster: ClusterRecord,
  options: ClusterAccessOptions,
): Promise<ClusterAccess> {
  const endpoint = options.endpoints.get(cluster.id) ?? { host: cluster.host, port: cluster.port };
  if (cluster.tlsMode === 'DISABLE') {
    if (!isLocalOrCi(options.appEnv)) throw new ToolError('CLUSTER_TLS_REQUIRED');
    return { clusterId: cluster.id, endpoint, tls: { mode: 'disable' } };
  }
  if (cluster.caSecretRef === null) throw new ToolError('SECRET_UNRESOLVABLE');
  const ca = await options.secretStore.get(cluster.caSecretRef);
  return { clusterId: cluster.id, endpoint, tls: { mode: 'verify-full', ca } };
}

/**
 * Resolves the access of the clusters a command works on, once per cluster: the CA is read from
 * the secret store only once, however many practices a cluster holds.
 */
export function clusterAccessResolver(
  clusters: readonly ClusterRecord[],
  options: ClusterAccessOptions,
): (clusterId: string | null) => Promise<ClusterAccess> {
  const byId = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const resolved = new Map<string, Promise<ClusterAccess>>();
  return (clusterId) => {
    const cluster = clusterId === null ? undefined : byId.get(clusterId);
    if (cluster === undefined) return Promise.reject(new ToolError('CLUSTER_NOT_FOUND'));
    let access = resolved.get(cluster.id);
    if (access === undefined) {
      access = resolveClusterAccess(cluster, options);
      resolved.set(cluster.id, access);
    }
    return access;
  };
}

/**
 * The pg options of a connection to a cluster. VERIFY_FULL verifies the certificate chain against
 * the cluster's CA and the host name; an IP address is matched against the certificate's IP
 * entries, because TLS forbids an IP address as the server name (RFC 6066).
 */
export function pgConnectionConfig(
  access: ClusterAccess,
  credentials: Credentials,
  applicationName: string,
): ClientConfig {
  const { host, port } = access.endpoint;
  return {
    host,
    port,
    user: credentials.user,
    password: credentials.password,
    database: credentials.database,
    application_name: applicationName,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    ssl:
      access.tls.mode === 'disable'
        ? false
        : {
            ca: access.tls.ca,
            rejectUnauthorized: true,
            ...(isIP(host) === 0 ? { servername: host } : {}),
          },
  };
}

/**
 * The connection URL the Prisma CLI gets for a database of a cluster (02 §6): VERIFY_FULL becomes
 * `sslmode=require&sslcert=<CA file>&sslaccept=strict`, whatever APP_ENV is; without TLS the URL
 * says `sslmode=disable`, so Prisma never tries TLS first.
 */
export function prismaDatasourceUrl(
  access: ClusterAccess,
  credentials: Credentials,
  options: { readonly applicationName: string; readonly caFile: string | undefined },
): string {
  const { host, port } = access.endpoint;
  const query = new URLSearchParams({ application_name: options.applicationName });
  if (access.tls.mode === 'disable') {
    query.set('sslmode', 'disable');
  } else {
    if (options.caFile === undefined)
      throw new TypeError('a VERIFY_FULL cluster needs its CA file');
    query.set('sslmode', 'require');
    query.set('sslcert', options.caFile);
    query.set('sslaccept', 'strict');
  }
  const hostPart = isIP(host) === 6 ? `[${host}]` : host;
  const user = encodeURIComponent(credentials.user);
  const password = encodeURIComponent(credentials.password);
  const database = encodeURIComponent(credentials.database);
  return `postgresql://${user}:${password}@${hostPart}:${String(port)}/${database}?${query.toString()}`;
}

function parseUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    // A malformed secret or variable: the value itself is never repeated.
    throw new ToolError('SECRET_UNRESOLVABLE');
  }
}

/** User, password and database of a `postgresql://` URL (the provisioner secret, the admin URL). */
export function credentialsFromUrl(url: string): Credentials {
  const parsed = parseUrl(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: database === '' ? 'postgres' : database,
  };
}

/** Host and port of a `postgresql://` URL; the default port is 5432. */
export function endpointFromUrl(url: string): Endpoint {
  const parsed = parseUrl(url);
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
  return { host, port: parsed.port === '' ? 5432 : Number(parsed.port) };
}

/**
 * The Prisma CLI reads a CA only from a file: one temporary file per VERIFY_FULL cluster, removed
 * when the command ends. The CA is public, but the directory stays private anyway.
 */
export interface CaFiles {
  pathFor(access: ClusterAccess): Promise<string | undefined>;
  dispose(): Promise<void>;
}

export function createCaFiles(): CaFiles {
  let directory: Promise<string> | undefined;
  const files = new Map<string, Promise<string>>();
  return {
    pathFor(access) {
      const { tls } = access;
      if (tls.mode === 'disable') return Promise.resolve(undefined);
      let file = files.get(access.clusterId);
      if (file === undefined) {
        directory ??= mkdtemp(path.join(tmpdir(), 'medibooker-db-'));
        file = directory.then(async (dir) => {
          const target = path.join(dir, `${access.clusterId}.pem`);
          await writeFile(target, tls.ca, { mode: 0o600 });
          return target;
        });
        files.set(access.clusterId, file);
      }
      return file;
    },
    async dispose() {
      if (directory === undefined) return;
      // A directory that could not be created holds nothing to remove.
      const dir = await directory.catch(() => undefined);
      if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    },
  };
}

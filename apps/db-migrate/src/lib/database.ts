import { Client, type ClientConfig } from 'pg';
import { CONNECT_TIMEOUT_MS } from './cluster.ts';

/** The application name of the tools' own connections; Prisma's are `medibooker-migrate`. */
export const TOOL_APPLICATION_NAME = 'medibooker-db';

/**
 * Opens a connection. A failed connection surfaces through the rejected promise or query; the
 * listener only keeps an error on an idle connection (for example a terminated session) from
 * crashing the process and printing its message.
 */
export async function connect(config: ClientConfig): Promise<Client> {
  const client = new Client({ connectionTimeoutMillis: CONNECT_TIMEOUT_MS, ...config });
  client.on('error', () => undefined);
  await client.connect();
  return client;
}

/** Runs `work` on a new connection and always closes it. */
export async function withConnection<T>(
  config: ClientConfig,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await connect(config);
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** pg options for a connection string given by the environment, such as PLATFORM_MIGRATION_URL. */
export function urlConnectionConfig(url: string): ClientConfig {
  return { connectionString: url, application_name: TOOL_APPLICATION_NAME };
}

/**
 * A copy of a `postgresql://` URL with another database or application name: pg and Prisma
 * read both from the URL, where they win over separate options.
 */
export function deriveUrl(
  url: string,
  change: { readonly database?: string; readonly applicationName?: string },
): string {
  const derived = new URL(url);
  if (change.database !== undefined) derived.pathname = `/${encodeURIComponent(change.database)}`;
  if (change.applicationName !== undefined) {
    derived.searchParams.set('application_name', change.applicationName);
  }
  return derived.toString();
}

/**
 * Quotes an SQL identifier. Names in DDL cannot be bind parameters; every name the tools build
 * comes from a validated UUID or a constant, and is quoted anyway.
 */
export function quoteIdent(name: string): string {
  if (name === '' || name.includes('\0')) throw new TypeError('invalid SQL identifier');
  return `"${name.replaceAll('"', '""')}"`;
}

/** Quotes an SQL string literal (standard_conforming_strings is on since PostgreSQL 9.1). */
export function quoteLiteral(value: string): string {
  if (value.includes('\0')) throw new TypeError('invalid SQL literal');
  return `'${value.replaceAll("'", "''")}'`;
}

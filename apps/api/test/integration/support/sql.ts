/**
 * Direct database access of the integration specs: catalog reads and the statements whose
 * permission errors the isolation specs assert. Every helper keeps clients and connection details
 * out of its results, so a failed assertion never prints a password.
 */
import { Client, type ClientConfig } from 'pg';

/** A row read for an assertion: compared as a whole, never used field by field. */
export type Row = Readonly<Record<string, unknown>>;

/** Opens a connection; an error on the idle connection (a terminated session) never crashes. */
export async function connect(config: string | ClientConfig): Promise<Client> {
  const client = new Client(typeof config === 'string' ? { connectionString: config } : config);
  client.on('error', () => undefined);
  await client.connect();
  return client;
}

/** Runs `work` on a new connection and always closes it. */
export async function withClient<T>(
  config: string | ClientConfig,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await connect(config);
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** How a connection attempt or a statement ended: the SQLSTATE and message of an error. */
export type Outcome = 'succeeded' | { readonly code: string | undefined; readonly message: string };

function failure(error: unknown): Outcome {
  if (!(error instanceof Error)) return { code: undefined, message: typeof error };
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  return { code, message: error.message };
}

/** Connects, disconnects again, and reports the outcome instead of a client. */
export async function connectionOutcome(config: ClientConfig): Promise<Outcome> {
  try {
    const client = await connect(config);
    await client.end().catch(() => undefined);
    return 'succeeded';
  } catch (error) {
    return failure(error);
  }
}

/** Runs one statement and reports the outcome instead of its rows. */
export async function statementOutcome(
  client: Client,
  sql: string,
  values: readonly unknown[] = [],
): Promise<Outcome> {
  try {
    await client.query(sql, [...values]);
    return 'succeeded';
  } catch (error) {
    return failure(error);
  }
}

/** Quotes an SQL identifier, for names read from the catalog. */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** The row count of every table in the public schema, by table name. */
export async function rowCounts(config: string | ClientConfig): Promise<Record<string, number>> {
  return withClient(config, async (client) => {
    const tables = await client.query<{ name: string }>(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const counts: Record<string, number> = {};
    for (const { name } of tables.rows) {
      const result = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM ${quoteIdent(name)}`,
      );
      counts[name] = Number(result.rows[0]?.count);
    }
    return counts;
  });
}

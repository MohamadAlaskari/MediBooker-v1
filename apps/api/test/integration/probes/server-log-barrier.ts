import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { withClient } from '../support/sql.js';

/**
 * A server's log with every line written before this call. PostgreSQL writes a statement's log and
 * error lines before it answers the client, and the test clusters log every statement
 * (log_statement=all), so once a statement with a fresh marker, sent now, is in the log, every
 * line of the statements that answered before is too. Absence checks read the log this way.
 *
 * @param read reads the server's log, for example readServerLog
 * @param connection a connection URL of the same server, for the marker statement
 */
export async function serverLogThroughNow(
  read: () => Promise<string>,
  connection: string,
): Promise<string> {
  const marker = `log-barrier-${randomUUID()}`;
  await withClient(connection, (client) => client.query(`SELECT '${marker}'`));
  let log = '';
  await expect
    .poll(
      async () => {
        log = await read();
        return log.includes(marker);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return log;
}

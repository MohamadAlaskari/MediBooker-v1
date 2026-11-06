import type { Client } from 'pg';
import { quoteIdent, quoteLiteral } from './database.ts';
import { ToolError } from './errors.ts';

export interface PracticeDatabaseNames {
  readonly databaseName: string;
  readonly ownerRole: string;
  readonly appRole: string;
}

export interface CreatePracticeDatabaseOptions {
  /** Copy this migrated template instead of template0: local and CI template copies only. */
  readonly template?: string;
}

/**
 * Creates a practice database: the only code that does (ADR 0005 §4.2), for provisioning,
 * restore, move and the template copies of local and CI tests. Runs as medibooker_provisioner (as
 * the cluster superuser for template copies), which switches to the owner role for the owner-only
 * statements (02 §6):
 *
 * 1. `CREATE DATABASE … OWNER <owner>` with the builtin `C.UTF-8` locale (ADR 0005 §5.3);
 * 2. as the owner: `CONNECT` revoked from PUBLIC (PostgreSQL grants it on every new database),
 *    granted to the practice's app role, and the app role's name stored as the database setting
 *    `medibooker.app_role`, which the practice migrations grant their table privileges to.
 *
 * Idempotent: an existing database is not created again, but step 2 runs on every call, so a run
 * that stopped between the two steps closes the database on the next one. After a failure the
 * caller discards the connection, which may still be switched to the owner role.
 */
export async function createPracticeDatabase(
  client: Client,
  names: PracticeDatabaseNames,
  options: CreatePracticeDatabaseOptions = {},
): Promise<{ created: boolean }> {
  const database = quoteIdent(names.databaseName);
  const owner = quoteIdent(names.ownerRole);
  const app = quoteIdent(names.appRole);
  const existing = await client.query<{ found: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS found',
    [names.databaseName],
  );
  const created = existing.rows[0]?.found !== true;
  if (created) {
    const template = quoteIdent(options.template ?? 'template0');
    await client.query(
      `CREATE DATABASE ${database} OWNER ${owner} TEMPLATE ${template} ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'`,
    );
  }
  await client.query(`SET ROLE ${owner}`);
  await client.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${app}`);
  await client.query(
    `ALTER DATABASE ${database} SET medibooker.app_role = ${quoteLiteral(names.appRole)}`,
  );
  await client.query('RESET ROLE');
  return { created };
}

/** What provisioning knows about a practice beyond its identity (P01). */
export interface PracticeBaseSettings {
  /** `--time-zone`: an IANA zone. */
  readonly timeZone?: string | undefined;
  /** `--default-locale`: added to the supported locales when they lack it. */
  readonly defaultLocale?: string | undefined;
}

/**
 * Writes the given values into the `practice_settings` row that the migration inserted, on a
 * connection to the practice database. A value that is not given stays as it is, so a rerun of
 * provisioning without them changes nothing.
 */
export async function writePracticeSettings(
  client: Client,
  settings: PracticeBaseSettings,
): Promise<void> {
  const { timeZone, defaultLocale } = settings;
  if (timeZone === undefined && defaultLocale === undefined) return;
  await client.query(
    `UPDATE practice_settings SET
       time_zone = COALESCE($1::text, time_zone),
       default_locale = COALESCE($2::text, default_locale),
       supported_locales = CASE
         WHEN COALESCE($2::text, default_locale) = ANY (supported_locales) THEN supported_locales
         ELSE array_append(supported_locales, $2::text)
       END,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [timeZone ?? null, defaultLocale ?? null],
  );
}

/**
 * Writes the singleton `practice_identity` row (ADR 0005 §5.3, step 6) on a connection to the
 * practice database, once, and proves that the row names this practice: the connection manager
 * compares it with the registry before it serves a client.
 */
export async function writePracticeIdentity(client: Client, practiceId: string): Promise<void> {
  await client.query(
    'INSERT INTO practice_identity (id, practice_id) VALUES (1, $1) ON CONFLICT (id) DO NOTHING',
    [practiceId],
  );
  const result = await client.query<{ practice_id: string }>(
    'SELECT practice_id FROM practice_identity WHERE id = 1',
  );
  if (result.rows[0]?.practice_id !== practiceId) throw new ToolError('PRACTICE_IDENTITY_MISMATCH');
}

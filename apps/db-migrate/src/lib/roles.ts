import type { Client } from 'pg';
import { quoteIdent, quoteLiteral } from './database.ts';
import { ToolError } from './errors.ts';
import { scramSha256Verifier } from './scram.ts';

/** PRACTICE_APP_CONNECTION_LIMIT and PRACTICE_OWNER_CONNECTION_LIMIT (ADR 0005 §2.3). */
export interface ConnectionLimits {
  readonly app: number;
  readonly owner: number;
}

export interface PracticeRoleNames {
  readonly appRole: string;
  readonly ownerRole: string;
}

export interface RolePasswords {
  readonly app: string;
  readonly owner: string;
}

async function roleExists(client: Client, name: string): Promise<boolean> {
  const result = await client.query<{ found: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS found',
    [name],
  );
  return result.rows[0]?.found === true;
}

/**
 * Applies the connection limits to both roles and the app role's timeouts (ADR 0005 §2.3):
 * provisioning on every run, `roles reconcile` for every practice. Needs a role with CREATEROLE
 * and the ADMIN option on both roles (the provisioner that created them) or the superuser.
 */
export async function applyRoleSettings(
  client: Client,
  names: PracticeRoleNames,
  limits: ConnectionLimits,
): Promise<void> {
  for (const role of [names.ownerRole, names.appRole]) {
    if (!(await roleExists(client, role))) throw new ToolError('ROLE_MISSING');
  }
  const owner = quoteIdent(names.ownerRole);
  const app = quoteIdent(names.appRole);
  await client.query(`ALTER ROLE ${owner} CONNECTION LIMIT ${String(limits.owner)}`);
  await client.query(`ALTER ROLE ${app} CONNECTION LIMIT ${String(limits.app)}`);
  await client.query(`ALTER ROLE ${app} SET statement_timeout = '15s'`);
  await client.query(`ALTER ROLE ${app} SET idle_in_transaction_session_timeout = '30s'`);
}

/**
 * Creates the practice's owner and app roles where absent, each with `LOGIN` and its password as
 * a SCRAM-SHA-256 verifier, never the password (02 §6), then applies the limits and settings. An
 * existing role keeps its password: provisioning reuses its secrets, and rotation is OPS02's
 * `rotate-credentials`.
 */
export async function ensurePracticeRoles(
  client: Client,
  names: PracticeRoleNames,
  passwords: RolePasswords,
  limits: ConnectionLimits,
): Promise<void> {
  const roles = [
    { name: names.ownerRole, password: passwords.owner, limit: limits.owner },
    { name: names.appRole, password: passwords.app, limit: limits.app },
  ];
  for (const role of roles) {
    if (await roleExists(client, role.name)) continue;
    const verifier = quoteLiteral(scramSha256Verifier(role.password));
    await client.query(
      `CREATE ROLE ${quoteIdent(role.name)} LOGIN PASSWORD ${verifier} CONNECTION LIMIT ${String(role.limit)}`,
    );
  }
  await applyRoleSettings(client, names, limits);
}

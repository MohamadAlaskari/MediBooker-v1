import { ToolError } from './errors.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The names of one practice's database, roles and secrets, all derived from its id (02 §6). */
export interface PracticeNames {
  /** The practice id in its canonical form: lowercase with hyphens. */
  readonly practiceId: string;
  /** The id without hyphens, as it appears in the database and role names. */
  readonly id32: string;
  readonly databaseName: string;
  readonly appRole: string;
  readonly ownerRole: string;
  /** Development store references (SECRET_STORE=dev); the provider's scheme arrives in OPS01. */
  readonly appSecretRef: string;
  readonly ownerSecretRef: string;
  /** The first data key of the practice (ADR 0005 §4.8). */
  readonly fieldKeyRef: string;
}

export function isPracticeId(value: string): boolean {
  return UUID.test(value.toLowerCase());
}

/** Derives every name of a practice; throws INVALID_ARGUMENTS for a value that is no UUID. */
export function practiceNames(practiceId: string): PracticeNames {
  const id = practiceId.toLowerCase();
  if (!UUID.test(id)) throw new ToolError('INVALID_ARGUMENTS');
  const id32 = id.replaceAll('-', '');
  const databaseName = `practice_${id32}`;
  const appRole = `${databaseName}_app`;
  const ownerRole = `${databaseName}_owner`;
  return {
    practiceId: id,
    id32,
    databaseName,
    appRole,
    ownerRole,
    appSecretRef: `dev:${appRole}`,
    ownerSecretRef: `dev:${ownerRole}`,
    fieldKeyRef: `dev:${databaseName}_field_key`,
  };
}

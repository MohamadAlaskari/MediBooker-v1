import { applyDecorators, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { StaffRole } from '../../generated/practice/enums.js';

/**
 * How a route names its practice (02 §5): `id`, the path parameter `practiceId`, or `slug`, the
 * path parameter `slug` of a public route.
 */
export type PracticeScope = 'id' | 'slug';

/**
 * Who may reach a practice named by `id` (02 §5). `patient`: a person with an index row and a patient
 * profile in the practice's database; with `confirmed` their account's address must be confirmed
 * too (BR-09), and that is said first, so that a person learns what to do. `join`: a confirmed
 * account, on a published practice, to create its own patient profile. `staff`: an active
 * membership of the practice in one of these roles, and a sign-in with both factors (A04).
 */
export interface PracticeScopedOptions {
  readonly patient?: true;
  readonly confirmed?: true;
  readonly join?: true;
  readonly staff?: readonly [StaffRole, ...StaffRole[]];
}

export type PracticeAccess = 'patient' | 'confirmed-patient' | 'join' | 'staff';

/** Every role of the practice: what a route names that all of its staff may reach. */
export const ALL_STAFF_ROLES: readonly [StaffRole, ...StaffRole[]] = ['STAFF', 'DOCTOR', 'ADMIN'];

function accessOf(options: PracticeScopedOptions): PracticeAccess | undefined {
  if (options.staff !== undefined) return 'staff';
  if (options.join === true) return 'join';
  if (options.patient !== true) return undefined;
  return options.confirmed === true ? 'confirmed-patient' : 'patient';
}

const PRACTICE_SCOPE = 'medibooker:practiceScope';
const PRACTICE_ACCESS = 'medibooker:practiceAccess';
const PRACTICE_STAFF_ROLES = 'medibooker:practiceStaffRoles';

/**
 * Marks a route handler as practice-scoped: the PracticeContextInterceptor resolves the practice
 * from the path, applies the access check, the status table, the market check and the schema guard,
 * and leases its client for the handler. Metadata, so a decorator that replaces the method keeps it
 * (02 §4).
 */
export function PracticeScoped(
  scope: PracticeScope,
  options: PracticeScopedOptions = {},
): MethodDecorator {
  const access = accessOf(options);
  // Only the id path reads the caller: an access rule on a public route would check nothing.
  if (scope === 'slug' && access !== undefined) {
    throw new Error('a slug route is public and takes no access rule');
  }
  return applyDecorators(
    SetMetadata(PRACTICE_SCOPE, scope),
    ...(access === undefined ? [] : [SetMetadata(PRACTICE_ACCESS, access)]),
    ...(options.staff === undefined ? [] : [SetMetadata(PRACTICE_STAFF_ROLES, options.staff)]),
  );
}

/** The practice scope of a route handler, or undefined for a route without a practice. */
export function practiceScopeOf(
  handler: ReturnType<ExecutionContext['getHandler']>,
): PracticeScope | undefined {
  const scope: unknown = Reflect.getMetadata(PRACTICE_SCOPE, handler);
  return scope === 'id' || scope === 'slug' ? scope : undefined;
}

/** Who may reach the practice of a route handler, when the route says. */
export function practiceAccessOf(
  handler: ReturnType<ExecutionContext['getHandler']>,
): PracticeAccess | undefined {
  const access: unknown = Reflect.getMetadata(PRACTICE_ACCESS, handler);
  return access === 'patient' ||
    access === 'confirmed-patient' ||
    access === 'join' ||
    access === 'staff'
    ? access
    : undefined;
}

/** The roles a staff route admits; empty for any other route. */
export function practiceStaffRolesOf(
  handler: ReturnType<ExecutionContext['getHandler']>,
): readonly StaffRole[] {
  const roles: unknown = Reflect.getMetadata(PRACTICE_STAFF_ROLES, handler);
  return Array.isArray(roles) ? (roles as StaffRole[]) : [];
}

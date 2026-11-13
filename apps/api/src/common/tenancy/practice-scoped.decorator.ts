import { applyDecorators, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { STAFF_CAPABILITIES, type StaffCapability } from './staff-capability.js';

/**
 * How a route names its practice (02 §5): `id`, the path parameter `practiceId`, or `slug`, the
 * path parameter `slug` of a public route.
 */
export type PracticeScope = 'id' | 'slug';

/**
 * Who may reach a practice named by `id` (02 §5). `patient`: a person with an index row and a patient
 * profile in the practice's database; with `confirmed` their account's address must be confirmed
 * too (BR-09), and that is said first, so that a person learns what to do. `join`: a confirmed
 * account, on a published practice, to create its own patient profile. `account`: a signed-in
 * account with a confirmed address, on a published practice, without a row there (B07: the free
 * times); signing up asks for no proof of the address, so without one it would be public. `staff`:
 * an active membership of the practice with this capability (D17: `team`, `planning` or
 * `management`), and a sign-in with both factors (A04). A route names exactly one of them;
 * `confirmed` goes only with `patient`.
 */
export interface PracticeScopedOptions {
  readonly patient?: true;
  readonly account?: true;
  readonly confirmed?: true;
  readonly join?: true;
  readonly staff?: StaffCapability;
}

export type PracticeAccess = 'patient' | 'confirmed-patient' | 'account' | 'join' | 'staff';

/**
 * The one rule a route names. Two would silently become one of them, which could be the weaker one
 * (the security review of B07): so it throws, when the class is defined.
 */
function accessOf(options: PracticeScopedOptions): PracticeAccess | undefined {
  const named = [
    options.staff !== undefined,
    options.join === true,
    options.account === true,
    options.patient === true,
  ].filter(Boolean).length;
  if (named > 1) throw new Error('a practice route names one access rule');
  if (options.confirmed === true && options.patient !== true) {
    throw new Error('confirmed goes with patient: join and account confirm by themselves');
  }
  if (options.staff !== undefined) return 'staff';
  if (options.join === true) return 'join';
  if (options.account === true) return 'account';
  if (options.patient !== true) return undefined;
  return options.confirmed === true ? 'confirmed-patient' : 'patient';
}

const PRACTICE_SCOPE = 'medibooker:practiceScope';
const PRACTICE_ACCESS = 'medibooker:practiceAccess';
const PRACTICE_STAFF_CAPABILITY = 'medibooker:practiceStaffCapability';

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
    ...(options.staff === undefined ? [] : [SetMetadata(PRACTICE_STAFF_CAPABILITY, options.staff)]),
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
    access === 'account' ||
    access === 'join' ||
    access === 'staff'
    ? access
    : undefined;
}

/** What a staff route asks of the caller's membership; undefined for any other route. */
export function practiceStaffCapabilityOf(
  handler: ReturnType<ExecutionContext['getHandler']>,
): StaffCapability | undefined {
  const capability: unknown = Reflect.getMetadata(PRACTICE_STAFF_CAPABILITY, handler);
  return STAFF_CAPABILITIES.find((known) => known === capability);
}

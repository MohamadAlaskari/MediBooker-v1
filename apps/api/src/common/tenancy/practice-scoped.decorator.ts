import { applyDecorators, type ExecutionContext, SetMetadata } from '@nestjs/common';

/**
 * How a route names its practice (02 §5): `id`, the path parameter `practiceId`, or `slug`, the
 * path parameter `slug` of a public route.
 */
export type PracticeScope = 'id' | 'slug';

/**
 * Who may reach a practice named by `id` (02 §5). `patient`: a person with an index row and a patient
 * profile in the practice's database. `join`: a confirmed account, on a published practice, to create
 * its own patient profile. Staff roles follow with A04.
 */
export interface PracticeScopedOptions {
  readonly patient?: true;
  readonly join?: true;
}

export type PracticeAccess = 'patient' | 'join';

const PRACTICE_SCOPE = 'medibooker:practiceScope';
const PRACTICE_ACCESS = 'medibooker:practiceAccess';

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
  const access: PracticeAccess | undefined =
    options.patient === true ? 'patient' : options.join === true ? 'join' : undefined;
  return applyDecorators(
    SetMetadata(PRACTICE_SCOPE, scope),
    ...(access === undefined ? [] : [SetMetadata(PRACTICE_ACCESS, access)]),
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
  return access === 'patient' || access === 'join' ? access : undefined;
}

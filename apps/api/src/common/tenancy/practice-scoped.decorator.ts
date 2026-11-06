import { type ExecutionContext, SetMetadata } from '@nestjs/common';

/**
 * How a route names its practice (02 §5): `id`, the path parameter `practiceId`, or `slug`, the
 * path parameter `slug` of a public route. A01 adds the index, membership and role checks to `id`.
 */
export type PracticeScope = 'id' | 'slug';

const PRACTICE_SCOPE = 'medibooker:practiceScope';

/**
 * Marks a route handler as practice-scoped: the PracticeContextInterceptor resolves the practice
 * from the path, applies the status table, the market check and the schema guard, and leases its
 * client for the handler. Metadata, so a decorator that replaces the method keeps it (02 §4).
 */
export function PracticeScoped(scope: PracticeScope): MethodDecorator {
  return SetMetadata(PRACTICE_SCOPE, scope);
}

/** The practice scope of a route handler, or undefined for a route without a practice. */
export function practiceScopeOf(
  handler: ReturnType<ExecutionContext['getHandler']>,
): PracticeScope | undefined {
  const scope: unknown = Reflect.getMetadata(PRACTICE_SCOPE, handler);
  return scope === 'id' || scope === 'slug' ? scope : undefined;
}

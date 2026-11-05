import type { ExecutionContext } from '@nestjs/common';

/** A route handler, as `ExecutionContext.getHandler()` returns it. */
type RouteHandler = ReturnType<ExecutionContext['getHandler']>;

/**
 * The handlers marked with `@Public()`. The set is private to this module and the marker is no
 * metadata, so no other code can mark a handler, and copying a handler's metadata (`SetMetadata`,
 * `Reflect.defineMetadata`) never copies the marker. A decorator that applies `Public()` itself,
 * such as `applyDecorators(Public(), Get())`, does mark its handler: the control over which routes
 * are public is the route inventory test (public-routes.spec.ts), not this module (02 §4).
 */
const publicHandlers = new WeakSet<RouteHandler>();

function markPublic(
  _target: object,
  _propertyKey?: string | symbol,
  descriptor?: PropertyDescriptor,
): void {
  const handler: unknown = descriptor?.value;
  if (typeof handler !== 'function') {
    throw new TypeError('@Public() marks a route handler: put it on the method, not the class');
  }
  publicHandlers.add(handler);
}

/**
 * Marks one route handler as a reviewed exception to deny-by-default (02 §4). Every use carries a
 * comment with its reason; it is allowed only under `/api/v1/public/**`, `/health/**` and the auth
 * routes (A01). It marks a method only, and applied to a class it throws when the class is
 * defined, so a class can never open every route of a controller, including routes added later.
 * It is the outermost decorator of its handler: a decorator above it that replaces the method
 * (`@UseCls()`, `@Transactional()`) leaves the marker on the replaced function, so the route stays
 * closed.
 */
export function Public(): MethodDecorator {
  return markPublic;
}

/**
 * True when the handler carries `@Public()`: the reader of `AuthenticationGuard` and of the route
 * inventory test.
 */
export function isPublicHandler(handler: RouteHandler): boolean {
  return publicHandlers.has(handler);
}

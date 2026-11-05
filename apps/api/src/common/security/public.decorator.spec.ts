import { applyDecorators, type ExecutionContext, Get, SetMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import * as publicDecorator from './public.decorator.js';

const { Public, isPublicHandler } = publicDecorator;

/** A decorator that applies `Public()` itself, as a wrapper decorator would. */
const PublicGet = (): MethodDecorator => applyDecorators(Public(), Get('composed'));

class Routes {
  @Public() // test-only: the marked handler
  open(): void {
    // a route handler's body does not matter here
  }

  closed(): void {
    // a route handler's body does not matter here
  }

  @SetMetadata('medibooker:isPublic', true)
  markedWithFormerStringKey(): void {
    // a route handler's body does not matter here
  }

  @PublicGet() // test-only: marked through a composed decorator
  composed(): void {
    // a route handler's body does not matter here
  }

  copiedMetadata(): void {
    // a route handler's body does not matter here
  }
}

/** A method of a class as the guard gets it: `ExecutionContext.getHandler()`. */
function handlerOf(routes: object, method: string): ReturnType<ExecutionContext['getHandler']> {
  const handler: unknown = Object.getOwnPropertyDescriptor(routes, method)?.value;
  if (typeof handler !== 'function') throw new Error(`${method} is not a method`);
  return handler;
}

describe('@Public() and its reader', () => {
  it('exports only the decorator and the reader', () => {
    expect(Object.keys(publicDecorator).sort()).toEqual(['Public', 'isPublicHandler']);
  });

  it('marks the decorated handler and no other', () => {
    expect(isPublicHandler(handlerOf(Routes.prototype, 'open'))).toBe(true);
    expect(isPublicHandler(handlerOf(Routes.prototype, 'closed'))).toBe(false);
  });

  it('is not set by SetMetadata with the former string key', () => {
    const handler = handlerOf(Routes.prototype, 'markedWithFormerStringKey');
    expect(isPublicHandler(handler)).toBe(false);
  });

  it('has no metadata key to set or copy: a handler with all metadata of a marked one stays closed', () => {
    const marked = handlerOf(Routes.prototype, 'composed');
    const copy = handlerOf(Routes.prototype, 'copiedMetadata');
    const keys: unknown[] = Reflect.getMetadataKeys(marked);
    // Positive control: the composed decorator left metadata (Get's path and method) to copy.
    expect(keys).toEqual(expect.arrayContaining(['path', 'method']));
    for (const key of keys) Reflect.defineMetadata(key, Reflect.getMetadata(key, marked), copy);
    expect(isPublicHandler(copy)).toBe(false);
    expect('KEY' in Public()).toBe(false);
  });

  it('marks a handler through a decorator that applies Public() itself', () => {
    // The route inventory test, not this module, controls which routes are public (02 §4).
    expect(isPublicHandler(handlerOf(Routes.prototype, 'composed'))).toBe(true);
  });

  it('throws on a class: the marker counts per handler and never opens a whole controller', () => {
    const publicOnClass = Public() as unknown as ClassDecorator;
    class ClassMarkedRoutes {
      route(): void {
        // a route handler's body does not matter here
      }
    }
    expect(() => {
      publicOnClass(ClassMarkedRoutes);
    }).toThrow(TypeError);
  });
});

import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { fakePinoLogger } from '../../../test/support/fake-pino-logger.js';
import { Public } from '../security/public.decorator.js';
import { NoStoreInterceptor } from './no-store.interceptor.js';
import { PublicCache } from './public-cache.decorator.js';

class Handlers {
  plain(): void {
    // a route handler's body does not matter here
  }

  @Public() // only to test the interceptor's rule
  @PublicCache(300)
  cachedAndPublic(): void {
    // a route handler's body does not matter here
  }

  @PublicCache(300)
  cachedButSignedIn(): void {
    // a route handler's body does not matter here
  }
}

const handlerOf = (name: keyof Handlers): unknown => Reflect.get(Handlers.prototype, name);

/** The header the interceptor sets for a handler at an address, and what it logged. */
function cacheControlOf(name: keyof Handlers, url: string) {
  const { logger, calls } = fakePinoLogger();
  const interceptor = new NoStoreInterceptor(new Reflector(), logger);
  const setHeader = vi.fn();
  const context = {
    getHandler: () => handlerOf(name),
    getClass: () => Handlers,
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: url, url }),
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of(undefined) };
  void interceptor.intercept(context, next);
  return { header: setHeader.mock.calls[0]?.[1] as unknown, calls };
}

describe('NoStoreInterceptor (02 §4, RT-12)', () => {
  it('answers no-store by default', () => {
    expect(cacheControlOf('plain', '/api/v1/me').header).toBe('no-store');
  });

  it('opens a public cache for a public route under /api/v1/public/', () => {
    const { header, calls } = cacheControlOf('cachedAndPublic', '/api/v1/public/app-config');
    expect(header).toBe('public, max-age=300');
    expect(calls).toEqual([]);
  });

  it('keeps no-store for the marker on a route that needs a sign-in, and says so', () => {
    const { header, calls } = cacheControlOf(
      'cachedButSignedIn',
      '/api/v1/public/practices/al-noor',
    );
    expect(header).toBe('no-store');
    expect(calls).toEqual([
      {
        level: 'error',
        fields: {},
        message: '@PublicCache outside a public route: the answer stays no-store',
      },
    ]);
  });

  it('keeps no-store for a public route outside /api/v1/public/, and says so', () => {
    for (const url of ['/api/v1/practices/x/free-times?serviceId=y', '/health/live']) {
      const { header, calls } = cacheControlOf('cachedAndPublic', url);
      expect(header).toBe('no-store');
      expect(calls.map(({ level }) => level)).toEqual(['error']);
    }
  });
});

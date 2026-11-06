import type { ServerResponse } from 'node:http';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { PUBLIC_CACHE_SECONDS } from './public-cache.decorator.js';

/**
 * Every response answers `Cache-Control: no-store` unless its route opens one on purpose with
 * `@PublicCache`: a public cache must never keep a response with personal or health data. Errors
 * get `no-store` from the ProblemDetailsFilter, also on such a route.
 */
@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const seconds = this.reflector.get<number | undefined>(
      PUBLIC_CACHE_SECONDS,
      context.getHandler(),
    );
    context
      .switchToHttp()
      .getResponse<ServerResponse>()
      .setHeader(
        'Cache-Control',
        seconds === undefined ? 'no-store' : `public, max-age=${String(seconds)}`,
      );
    return next.handle();
  }
}

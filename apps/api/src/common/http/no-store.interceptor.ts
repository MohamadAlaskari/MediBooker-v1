import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import type { Observable } from 'rxjs';
import { isPublicHandler } from '../security/public.decorator.js';
import { PUBLIC_CACHE_SECONDS } from './public-cache.decorator.js';

/** The only routes whose answers a shared cache may keep (02 §4, RT-12). */
const PUBLIC_PREFIX = '/api/v1/public/';

/**
 * Every response answers `Cache-Control: no-store` unless its route opens one on purpose with
 * `@PublicCache`, and only a `@Public()` route under `/api/v1/public/` can: a public cache must
 * never keep a response with personal or health data (RT-12). Anywhere else the marker keeps
 * `no-store` and logs an error, as the security review of B07 found it missing. Errors get
 * `no-store` from the ProblemDetailsFilter, also on such a route.
 */
@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(NoStoreInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = context.getHandler();
    const seconds = this.reflector.get<number | undefined>(PUBLIC_CACHE_SECONDS, handler);
    const http = context.switchToHttp();
    http
      .getResponse<ServerResponse>()
      .setHeader('Cache-Control', this.cacheControl(context, seconds));
    return next.handle();
  }

  private cacheControl(context: ExecutionContext, seconds: number | undefined): string {
    if (seconds === undefined) return 'no-store';
    const request = context.switchToHttp().getRequest<IncomingMessage & { originalUrl?: string }>();
    const path = request.originalUrl ?? request.url ?? '';
    if (isPublicHandler(context.getHandler()) && path.startsWith(PUBLIC_PREFIX)) {
      return `public, max-age=${String(seconds)}`;
    }
    // A constant message and no fields (02 §8): the few routes with the marker are found by name.
    this.logger.error({}, '@PublicCache outside a public route: the answer stays no-store');
    return 'no-store';
  }
}

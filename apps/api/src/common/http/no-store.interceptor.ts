import type { ServerResponse } from 'node:http';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

/**
 * Every response answers `Cache-Control: no-store` unless a later item opens one on purpose: a
 * public cache must never keep a response with personal or health data. P05 adds `@PublicCache`
 * for the free times. Errors get the same header from the ProblemDetailsFilter.
 */
@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    context.switchToHttp().getResponse<ServerResponse>().setHeader('Cache-Control', 'no-store');
    return next.handle();
  }
}

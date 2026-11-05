import type { ServerResponse } from 'node:http';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PinoLogger } from 'nestjs-pino';
import { type Observable, catchError, finalize, throwError } from 'rxjs';
import type { RequestContext } from '../context/request-context.js';
import { isUuid } from '../context/request-id.js';
import { isConnectionFailure } from '../database/prisma-errors.js';
import { bindLogFields } from '../logging/bind-log-fields.js';
import type { PracticeLease } from './practice-client.js';
import { PracticeConnectionManager } from './practice-connection-manager.js';
import { PracticeUnavailableError } from './practice-errors.js';
import { PracticeResolver } from './practice-resolver.js';
import { type PracticeRoute, resolvedPracticeOf } from './practice-route.js';
import { practiceScopeOf } from './practice-scoped.decorator.js';

/** The `Retry-After` of a practice that cannot be served (05 §1.3), until X01's catalogue. */
export const PRACTICE_RETRY_AFTER_SECONDS = 30;

/** The part of an Express request this interceptor reads. */
interface PracticeScopedRequest {
  readonly params?: Readonly<Record<string, string | undefined>>;
}

/**
 * Resolves the practice of a `@PracticeScoped('id')` route (02 §5): the path parameter
 * `practiceId` (404 unless it is a UUID), the registry row on every request, the status table for
 * signed-in requests (404 before any client is leased where it says so), the market check and
 * the schema guard, then a lease of the practice's client, stored in the request context and
 * released when the handler's result is complete, also after an error. A01 adds the index,
 * membership and role checks before the lease.
 *
 * A PracticeUnavailableError is answered with 503 and `Retry-After` (until X01), as is a query
 * that fails in the handler because the practice's connection failed; that client is closed. Only
 * the practice id and the reason code are logged.
 */
@Injectable()
export class PracticeContextInterceptor implements NestInterceptor {
  constructor(
    private readonly resolver: PracticeResolver,
    private readonly connections: PracticeConnectionManager,
    private readonly cls: ClsService<RequestContext>,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(PracticeContextInterceptor.name);
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (practiceScopeOf(context.getHandler()) === undefined) return next.handle();
    const http = context.switchToHttp();
    const response = http.getResponse<ServerResponse>();
    const practiceId = http.getRequest<PracticeScopedRequest>().params?.practiceId;
    if (!isUuid(practiceId)) throw new NotFoundException();
    const { route, lease } = await this.leasePractice(practiceId.toLowerCase(), response);
    try {
      this.cls.set('practice', { practice: resolvedPracticeOf(route), lease });
      bindLogFields(this.logger, { practiceId: route.id });
    } catch (error) {
      lease.release();
      throw error;
    }
    return next.handle().pipe(
      catchError((error: unknown) => throwError(() => this.answerOf(error, lease, response))),
      finalize(() => {
        lease.release();
      }),
    );
  }

  private async leasePractice(
    practiceId: string,
    response: ServerResponse,
  ): Promise<{ route: PracticeRoute; lease: PracticeLease }> {
    const resolution = await this.resolver.resolve(practiceId, 'request');
    if (resolution.answer === 'NOT_FOUND') throw new NotFoundException();
    if (resolution.answer === 'UNAVAILABLE') {
      throw this.unavailable(new PracticeUnavailableError(practiceId, resolution.reason), response);
    }
    try {
      return {
        route: resolution.route,
        lease: await this.connections.acquire(resolution.route, 'request'),
      };
    } catch (error) {
      if (error instanceof PracticeUnavailableError) throw this.unavailable(error, response);
      throw error;
    }
  }

  /** What the handler's error becomes: 503 for an unavailable practice or a failed connection. */
  private answerOf(error: unknown, lease: PracticeLease, response: ServerResponse): unknown {
    if (error instanceof PracticeUnavailableError) return this.unavailable(error, response);
    if (!isConnectionFailure(error)) return error;
    this.connections.close(lease);
    const unavailable = new PracticeUnavailableError(
      lease.practiceId,
      'PRACTICE_CONNECTION_FAILED',
      { cause: error },
    );
    return this.unavailable(unavailable, response);
  }

  private unavailable(
    error: PracticeUnavailableError,
    response: ServerResponse,
  ): ServiceUnavailableException {
    this.logger.warn(
      { practiceId: error.practiceId, reasonCode: error.reason },
      'practice unavailable',
    );
    if (!response.headersSent) {
      response.setHeader('Retry-After', String(PRACTICE_RETRY_AFTER_SECONDS));
    }
    return new ServiceUnavailableException();
  }
}

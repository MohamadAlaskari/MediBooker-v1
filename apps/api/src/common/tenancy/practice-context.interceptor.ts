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
import {
  isPracticeSlug,
  type PracticeListing,
  type PracticePurpose,
  type PracticeRoute,
  resolvedPracticeOf,
} from './practice-route.js';
import { practiceScopeOf } from './practice-scoped.decorator.js';

/** The `Retry-After` of a practice that cannot be served (05 §1.3), until X01's catalogue. */
export const PRACTICE_RETRY_AFTER_SECONDS = 30;

/** The practice of a request after its checks: its client's lease, and a public route's listing. */
interface LeasedPractice {
  readonly route: PracticeRoute;
  readonly lease: PracticeLease;
  readonly listing?: PracticeListing;
}

/** The part of an Express request this interceptor reads. */
interface PracticeScopedRequest {
  readonly params?: Readonly<Record<string, string | undefined>>;
}

/**
 * Resolves the practice of a `@PracticeScoped()` route (02 §5): the path parameter `practiceId`
 * (404 unless it is a UUID) or the public route's `slug` (404 unless it has a slug's form), the
 * registry row on every request, the status table for the route's purpose (404 before any client
 * is leased where it says so; for a slug also without a publication), the market check and the
 * schema guard, then a lease of the practice's client, stored in the request context and released
 * when the handler's result is complete, also after an error. A01 adds the index, membership and
 * role checks before the lease.
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
    const scope = practiceScopeOf(context.getHandler());
    if (scope === undefined) return next.handle();
    const http = context.switchToHttp();
    const response = http.getResponse<ServerResponse>();
    const params = http.getRequest<PracticeScopedRequest>().params;
    const { route, lease, listing } =
      scope === 'slug'
        ? await this.leaseBySlug(params?.slug, response)
        : await this.leaseById(params?.practiceId, response);
    try {
      this.cls.set('practice', {
        practice: resolvedPracticeOf(route),
        lease,
        ...(listing === undefined ? {} : { listing }),
      });
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

  private async leaseById(
    rawPracticeId: string | undefined,
    response: ServerResponse,
  ): Promise<LeasedPractice> {
    if (!isUuid(rawPracticeId)) throw new NotFoundException();
    const practiceId = rawPracticeId.toLowerCase();
    const resolution = await this.resolver.resolve(practiceId, 'request');
    if (resolution.answer === 'NOT_FOUND') throw new NotFoundException();
    if (resolution.answer === 'UNAVAILABLE') {
      throw this.unavailable(new PracticeUnavailableError(practiceId, resolution.reason), response);
    }
    return this.lease(resolution.route, 'request', response);
  }

  private async leaseBySlug(
    slug: string | undefined,
    response: ServerResponse,
  ): Promise<LeasedPractice> {
    if (!isPracticeSlug(slug)) throw new NotFoundException();
    const resolution = await this.resolver.resolveSlug(slug);
    if (resolution.answer === 'NOT_FOUND') throw new NotFoundException();
    if (resolution.answer === 'UNAVAILABLE') {
      throw this.unavailable(
        new PracticeUnavailableError(resolution.practiceId, resolution.reason),
        response,
      );
    }
    const leased = await this.lease(resolution.route, 'public', response);
    return { ...leased, listing: resolution.listing };
  }

  private async lease(
    route: PracticeRoute,
    purpose: PracticePurpose,
    response: ServerResponse,
  ): Promise<LeasedPractice> {
    try {
      return { route, lease: await this.connections.acquire(route, purpose) };
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

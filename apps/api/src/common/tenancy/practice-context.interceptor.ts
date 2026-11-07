import type { ServerResponse } from 'node:http';
import {
  type CallHandler,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  type NestInterceptor,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PinoLogger } from 'nestjs-pino';
import { type Observable, catchError, finalize, throwError } from 'rxjs';
import type { RequestContext } from '../context/request-context.js';
import { isUuid } from '../context/request-id.js';
import { isConnectionFailure } from '../database/prisma-errors.js';
import { DomainException } from '../errors/domain.exception.js';
import { bindLogFields } from '../logging/bind-log-fields.js';
import type { Actor } from '../security/actor.js';
import { PracticeAccessIndex } from './practice-access-index.js';
import type { PracticeLease } from './practice-client.js';
import { PracticeConnectionManager } from './practice-connection-manager.js';
import { PRACTICE_RETRY_AFTER_SECONDS, PracticeUnavailableError } from './practice-errors.js';
import { PracticeResolver } from './practice-resolver.js';
import {
  isPracticeSlug,
  type PracticeListing,
  type PracticePurpose,
  type PracticeRoute,
  resolvedPracticeOf,
} from './practice-route.js';
import {
  type PracticeAccess,
  practiceAccessOf,
  practiceScopeOf,
} from './practice-scoped.decorator.js';

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
 * when the handler's result is complete, also after an error.
 *
 * A `{ patient: true }` route first reads the membership index, so a caller without a row gets 404
 * and no client is opened, and then asks the practice database, which decides: a stale index row is
 * overruled there. A `{ join: true }` route needs a published practice and a confirmed account
 * (BR-09). The route's guard has verified the caller; staff roles follow with A04.
 *
 * A PracticeUnavailableError is answered with 503 and `Retry-After`, as is a query that fails in
 * the handler because the practice's connection failed; that client is closed. Only the practice
 * id and the reason code are logged, and the ProblemDetailsFilter writes the answer.
 */
@Injectable()
export class PracticeContextInterceptor implements NestInterceptor {
  constructor(
    private readonly resolver: PracticeResolver,
    private readonly connections: PracticeConnectionManager,
    private readonly index: PracticeAccessIndex,
    private readonly cls: ClsService<RequestContext>,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(PracticeContextInterceptor.name);
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const handler = context.getHandler();
    const scope = practiceScopeOf(handler);
    if (scope === undefined) return next.handle();
    const access = practiceAccessOf(handler);
    const http = context.switchToHttp();
    const response = http.getResponse<ServerResponse>();
    const params = http.getRequest<PracticeScopedRequest>().params;
    const { route, lease, listing } =
      scope === 'slug'
        ? await this.leaseBySlug(params?.slug, response)
        : await this.leaseById(params?.practiceId, access, response);
    try {
      const selfPatientId = access === 'patient' ? await this.selfPatientOf(lease) : undefined;
      this.cls.set('practice', {
        practice: resolvedPracticeOf(route),
        lease,
        ...(listing === undefined ? {} : { listing }),
        ...(selfPatientId === undefined ? {} : { selfPatientId }),
      });
      bindLogFields(this.logger, { practiceId: route.id });
    } catch (error) {
      // As for the handler: a failed connection is the practice's 503, and closes its client.
      const answer = this.answerOf(error, lease, response);
      lease.release();
      throw answer;
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
    access: PracticeAccess | undefined,
    response: ServerResponse,
  ): Promise<LeasedPractice> {
    if (!isUuid(rawPracticeId)) throw new NotFoundException();
    const practiceId = rawPracticeId.toLowerCase();
    if (access === 'patient') await this.requirePatientIndexRow(practiceId);
    const resolution =
      access === 'join'
        ? await this.resolver.resolvePublished(practiceId)
        : await this.resolver.resolve(practiceId, 'request');
    if (resolution.answer === 'NOT_FOUND') throw new NotFoundException();
    if (resolution.answer === 'UNAVAILABLE') {
      throw this.unavailable(new PracticeUnavailableError(practiceId, resolution.reason), response);
    }
    if (access === 'join' && !(await this.index.isVerified(this.actor().userId))) {
      throw new DomainException('EMAIL_NOT_VERIFIED');
    }
    return this.lease(resolution.route, 'request', response);
  }

  /** The caller the guard verified: a route with an access rule cannot be public. */
  private actor(): Actor {
    const actor = this.cls.get('actor');
    if (actor === undefined) throw new UnauthorizedException();
    return actor;
  }

  /** No row: 404, before any client is opened. Only another capacity there: 403. */
  private async requirePatientIndexRow(practiceId: string): Promise<void> {
    const capacities = await this.index.capacitiesOf(this.actor().userId, practiceId);
    if (capacities.length === 0) throw new NotFoundException();
    if (!capacities.includes('PATIENT')) throw new ForbiddenException();
  }

  /** The practice database decides: without a profile there, the index row was stale. */
  private async selfPatientOf(lease: PracticeLease): Promise<string> {
    const patient = await lease.client.patient.findFirst({
      where: { userId: this.actor().userId, relationship: 'SELF' },
      select: { id: true },
    });
    if (patient === null) throw new NotFoundException();
    return patient.id;
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

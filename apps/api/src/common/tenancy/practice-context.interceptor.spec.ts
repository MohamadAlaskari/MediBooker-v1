import {
  type CallHandler,
  type ExecutionContext,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { ClsServiceManager } from 'nestjs-cls';
import { defer, lastValueFrom, type Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { fakePinoLogger } from '../../../test/support/fake-pino-logger.js';
import { PRACTICE_A, practiceRoute } from '../../../test/support/practice-routes.js';
import type { RequestContext } from '../context/request-context.js';
import { DomainException } from '../errors/domain.exception.js';
import type { PracticeAccessIndex } from './practice-access-index.js';
import type { PracticeClient, PracticeLease } from './practice-client.js';
import type { PracticeConnectionManager } from './practice-connection-manager.js';
import { PracticeContextInterceptor } from './practice-context.interceptor.js';
import { PRACTICE_RETRY_AFTER_SECONDS, PracticeUnavailableError } from './practice-errors.js';
import type { PracticeResolution, PracticeResolver } from './practice-resolver.js';
import { PracticeScoped } from './practice-scoped.decorator.js';

const cls = ClsServiceManager.getClsService<RequestContext>();
const ROUTE = practiceRoute(PRACTICE_A);

class Handlers {
  @PracticeScoped('id')
  scoped(): void {
    // a route handler's body does not matter here
  }

  plain(): void {
    // a route handler's body does not matter here
  }

  @PracticeScoped('id', { patient: true })
  patient(): void {
    // a route handler's body does not matter here
  }

  @PracticeScoped('id', { patient: true, confirmed: true })
  confirmedPatient(): void {
    // a route handler's body does not matter here
  }

  @PracticeScoped('id', { join: true })
  join(): void {
    // a route handler's body does not matter here
  }
}

/** The handlers as Nest's ExecutionContext.getHandler() returns them. */
const SCOPED: unknown = Reflect.get(Handlers.prototype, 'scoped');
const PLAIN: unknown = Reflect.get(Handlers.prototype, 'plain');
const PATIENT: unknown = Reflect.get(Handlers.prototype, 'patient');
const CONFIRMED_PATIENT: unknown = Reflect.get(Handlers.prototype, 'confirmedPatient');
const JOIN: unknown = Reflect.get(Handlers.prototype, 'join');

interface Response {
  headersSent: boolean;
  setHeader: ReturnType<typeof vi.fn>;
}

function setUp(resolution: PracticeResolution = { answer: 'SERVE', route: ROUTE }) {
  const release = vi.fn();
  const findPatient = vi.fn().mockResolvedValue({ id: 'own-patient' });
  const client = { patient: { findFirst: findPatient } } as unknown as PracticeClient;
  const lease: PracticeLease = { practiceId: PRACTICE_A, client, release };
  const resolver = {
    resolve: vi.fn().mockResolvedValue(resolution),
    resolvePublished: vi.fn().mockResolvedValue(resolution),
  };
  const connections = { acquire: vi.fn().mockResolvedValue(lease), close: vi.fn() };
  const index = {
    capacitiesOf: vi.fn().mockResolvedValue(['PATIENT']),
    isVerified: vi.fn().mockResolvedValue(true),
  };
  const { logger, calls, assign } = fakePinoLogger();
  const interceptor = new PracticeContextInterceptor(
    resolver as unknown as PracticeResolver,
    connections as unknown as PracticeConnectionManager,
    index as unknown as PracticeAccessIndex,
    cls,
    logger,
  );
  const response: Response = { headersSent: false, setHeader: vi.fn() };
  const contextOf = (
    handler: unknown,
    params: Readonly<Record<string, string>> = { practiceId: PRACTICE_A },
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      switchToHttp: () => ({
        getRequest: () => ({ params }),
        getResponse: () => response,
      }),
    }) as unknown as ExecutionContext;
  return {
    interceptor,
    resolver,
    connections,
    index,
    findPatient,
    lease,
    release,
    assign,
    calls,
    response,
    contextOf,
  };
}

/** Runs the interceptor in a request context, as the request-context middleware opens one. */
function intercept(
  interceptor: PracticeContextInterceptor,
  context: ExecutionContext,
  handler: CallHandler,
): Promise<unknown> {
  return cls.run(async () => lastValueFrom(await interceptor.intercept(context, handler)));
}

const handlerOf = (result: () => Observable<unknown>): CallHandler => ({ handle: result });

const ACTOR = { userId: 'user-1', sessionId: 'session-1', amr: ['pwd'] };

/** As `intercept`, with the caller the authentication guard verified. */
function interceptAs(
  interceptor: PracticeContextInterceptor,
  context: ExecutionContext,
  handler: CallHandler,
): Promise<unknown> {
  return cls.run(async () => {
    cls.set('actor', ACTOR);
    return lastValueFrom(await interceptor.intercept(context, handler));
  });
}

describe('PracticeContextInterceptor (02 §5)', () => {
  it('leaves a route without @PracticeScoped alone', async () => {
    const { interceptor, resolver, contextOf } = setUp();
    expect(
      await intercept(
        interceptor,
        contextOf(PLAIN),
        handlerOf(() => of('plain')),
      ),
    ).toBe('plain');
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it.each<Readonly<Record<string, string>>>([
    {},
    { id: PRACTICE_A },
    { practiceId: 'not-a-uuid' },
    { practiceId: 'secret-value' },
  ])(
    'ADR-0005 §3 answers 404 for the route parameters %j before it reads the registry',
    async (params) => {
      const { interceptor, resolver, contextOf } = setUp();
      await expect(
        intercept(
          interceptor,
          contextOf(SCOPED, params),
          handlerOf(() => of(1)),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(resolver.resolve).not.toHaveBeenCalled();
    },
  );

  it('ADR-0005 §5.1 answers 404 where the status table says so, before any lease', async () => {
    const { interceptor, connections, contextOf } = setUp({ answer: 'NOT_FOUND' });
    await expect(
      intercept(
        interceptor,
        contextOf(SCOPED),
        handlerOf(() => of(1)),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(connections.acquire).not.toHaveBeenCalled();
  });

  it('ADR-0005 §5.1 answers 503 with Retry-After for a practice that cannot be served, before any lease', async () => {
    const { interceptor, connections, response, calls, contextOf } = setUp({
      answer: 'UNAVAILABLE',
      reason: 'PRACTICE_MARKET_NOT_SERVED',
    });
    await expect(
      intercept(
        interceptor,
        contextOf(SCOPED),
        handlerOf(() => of(1)),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(connections.acquire).not.toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith(
      'Retry-After',
      String(PRACTICE_RETRY_AFTER_SECONDS),
    );
    expect(calls).toEqual([
      {
        level: 'warn',
        fields: { practiceId: PRACTICE_A, reasonCode: 'PRACTICE_MARKET_NOT_SERVED' },
        message: 'practice unavailable',
      },
    ]);
  });

  it('answers 503 when no client can be leased', async () => {
    const { interceptor, connections, response, contextOf } = setUp();
    connections.acquire.mockRejectedValueOnce(
      new PracticeUnavailableError(PRACTICE_A, 'PRACTICE_IDENTITY_MISMATCH'),
    );
    await expect(
      intercept(
        interceptor,
        contextOf(SCOPED),
        handlerOf(() => of(1)),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '30');
  });

  it('passes on any other failure to lease a client', async () => {
    const { interceptor, connections, contextOf } = setUp();
    const failure = new Error('platform database refused');
    connections.acquire.mockRejectedValueOnce(failure);
    await expect(
      intercept(
        interceptor,
        contextOf(SCOPED),
        handlerOf(() => of(1)),
      ),
    ).rejects.toBe(failure);
  });

  it('stores the practice and the lease in the request context, binds the practice id, and releases the lease when the handler completes', async () => {
    const { interceptor, resolver, connections, lease, release, assign, contextOf } = setUp();
    const seen = await intercept(
      interceptor,
      contextOf(SCOPED, { practiceId: PRACTICE_A.toUpperCase() }),
      handlerOf(() => defer(() => of(cls.get('practice')))),
    );
    expect(resolver.resolve).toHaveBeenCalledWith(PRACTICE_A, 'request');
    expect(connections.acquire).toHaveBeenCalledWith(ROUTE, 'request');
    expect(seen).toEqual({
      practice: {
        id: PRACTICE_A,
        market: 'SA',
        routeVersion: 1,
        schemaVersion: ROUTE.schemaVersion,
      },
      lease,
    });
    expect(assign).toHaveBeenCalledWith({ practiceId: PRACTICE_A });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases the lease when the handler fails and passes the error on', async () => {
    const { interceptor, release, connections, contextOf } = setUp();
    const failure = new Error('booking failed');
    await expect(
      intercept(
        interceptor,
        contextOf(SCOPED),
        handlerOf(() => throwError(() => failure)),
      ),
    ).rejects.toBe(failure);
    expect(release).toHaveBeenCalledTimes(1);
    expect(connections.close).not.toHaveBeenCalled();
  });

  it('02 §5 item 7 closes the client and answers 503 when the handler fails because the connection failed', async () => {
    const { interceptor, release, connections, lease, response, calls, contextOf } = setUp();
    const terminated = new PrismaClientKnownRequestError('terminated', {
      code: 'P2039',
      clientVersion: '7.10.1',
      meta: {
        driverAdapterError: {
          cause: { kind: 'postgres', originalCode: '57P01', severity: 'FATAL' },
        },
      },
    });
    await expect(
      intercept(
        interceptor,
        contextOf(SCOPED),
        handlerOf(() => throwError(() => terminated)),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(connections.close).toHaveBeenCalledWith(lease);
    expect(release).toHaveBeenCalledTimes(1);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '30');
    expect(calls).toContainEqual(
      expect.objectContaining({
        fields: { practiceId: PRACTICE_A, reasonCode: 'PRACTICE_CONNECTION_FAILED' },
      }),
    );
  });

  it('answers 503 and keeps the client when the database is busy: it is the one that still works', async () => {
    const { interceptor, release, connections, response, calls, contextOf } = setUp();
    const busy = new Error('timeout exceeded when trying to connect');
    await expect(
      intercept(
        interceptor,
        contextOf(SCOPED),
        handlerOf(() => throwError(() => busy)),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(connections.close).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '30');
    expect(calls).toContainEqual(
      expect.objectContaining({ fields: { practiceId: PRACTICE_A, reasonCode: 'PRACTICE_BUSY' } }),
    );
  });

  it('answers 503 for a PracticeUnavailableError of the handler, without a header once the response is sent', async () => {
    const { interceptor, response, connections, contextOf } = setUp();
    response.headersSent = true;
    await expect(
      intercept(
        interceptor,
        contextOf(SCOPED),
        handlerOf(() =>
          throwError(() => new PracticeUnavailableError(PRACTICE_A, 'PRACTICE_STATUS_UNAVAILABLE')),
        ),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(connections.close).not.toHaveBeenCalled();
  });

  it('releases the lease when the context cannot be set, outside a request context', async () => {
    const { interceptor, release, contextOf } = setUp();
    await expect(
      interceptor.intercept(
        contextOf(SCOPED),
        handlerOf(() => of(1)),
      ),
    ).rejects.toThrow();
    expect(release).toHaveBeenCalledTimes(1);
  });

  describe('a { patient: true } route', () => {
    it('answers 404 without an index row, and opens no client', async () => {
      const { interceptor, index, connections, resolver, contextOf } = setUp();
      index.capacitiesOf.mockResolvedValue([]);
      await expect(
        interceptAs(
          interceptor,
          contextOf(PATIENT),
          handlerOf(() => of(1)),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(connections.acquire).not.toHaveBeenCalled();
    });

    it('answers 403 for another capacity, and opens no client', async () => {
      const { interceptor, index, connections, contextOf } = setUp();
      index.capacitiesOf.mockResolvedValue(['STAFF']);
      await expect(
        interceptAs(
          interceptor,
          contextOf(PATIENT),
          handlerOf(() => of(1)),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(connections.acquire).not.toHaveBeenCalled();
    });

    it('lets the practice database overrule a stale index row, and releases the client', async () => {
      const { interceptor, findPatient, release, contextOf } = setUp();
      findPatient.mockResolvedValue(null);
      await expect(
        interceptAs(
          interceptor,
          contextOf(PATIENT),
          handlerOf(() => of(1)),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(findPatient).toHaveBeenCalledWith({
        where: { userId: ACTOR.userId, relationship: 'SELF' },
        select: { id: true },
      });
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('answers a failed connection with 503, and closes that client', async () => {
      const { interceptor, findPatient, connections, lease, release, contextOf } = setUp();
      findPatient.mockRejectedValue(
        new PrismaClientKnownRequestError('terminated', {
          code: 'P2039',
          clientVersion: '7.10.1',
          meta: {
            driverAdapterError: {
              cause: { kind: 'postgres', originalCode: '57P01', severity: 'FATAL' },
            },
          },
        }),
      );
      await expect(
        interceptAs(
          interceptor,
          contextOf(PATIENT),
          handlerOf(() => of(1)),
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(connections.close).toHaveBeenCalledWith(lease);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('gives the handler the own profile of the caller', async () => {
      const { interceptor, contextOf } = setUp();
      await expect(
        interceptAs(
          interceptor,
          contextOf(PATIENT),
          handlerOf(() => defer(() => of(cls.get('practice')?.selfPatientId))),
        ),
      ).resolves.toBe('own-patient');
    });

    it('needs a caller: such a route can never be public', async () => {
      const { interceptor, connections, contextOf } = setUp();
      await expect(
        intercept(
          interceptor,
          contextOf(PATIENT),
          handlerOf(() => of(1)),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(connections.acquire).not.toHaveBeenCalled();
    });
  });

  describe('a { patient: true, confirmed: true } route', () => {
    it('says first that the address is not confirmed, and reads nothing more (BR-09)', async () => {
      const { interceptor, index, connections, contextOf } = setUp();
      index.isVerified.mockResolvedValue(false);
      index.capacitiesOf.mockResolvedValue([]);
      await expect(
        interceptAs(
          interceptor,
          contextOf(CONFIRMED_PATIENT),
          handlerOf(() => of(1)),
        ),
      ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
      expect(index.capacitiesOf).not.toHaveBeenCalled();
      expect(connections.acquire).not.toHaveBeenCalled();
    });

    it('asks a confirmed account for its index row and its profile as usual', async () => {
      const { interceptor, index, contextOf } = setUp();
      await expect(
        interceptAs(
          interceptor,
          contextOf(CONFIRMED_PATIENT),
          handlerOf(() => defer(() => of(cls.get('practice')?.selfPatientId))),
        ),
      ).resolves.toBe('own-patient');
      expect(index.capacitiesOf).toHaveBeenCalledWith(ACTOR.userId, PRACTICE_A);
    });
  });

  describe('a { join: true } route', () => {
    it('asks for a publication and needs no index row', async () => {
      const { interceptor, resolver, index, contextOf } = setUp();
      await expect(
        interceptAs(
          interceptor,
          contextOf(JOIN),
          handlerOf(() => of('joined')),
        ),
      ).resolves.toBe('joined');
      expect(resolver.resolvePublished).toHaveBeenCalledWith(PRACTICE_A);
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(index.capacitiesOf).not.toHaveBeenCalled();
    });

    it('answers 404 for a practice without a publication, whoever asks', async () => {
      const { interceptor, index, contextOf } = setUp({ answer: 'NOT_FOUND' });
      index.isVerified.mockResolvedValue(false);
      await expect(
        interceptAs(
          interceptor,
          contextOf(JOIN),
          handlerOf(() => of(1)),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses an account whose address is not confirmed, and opens no client (BR-09)', async () => {
      const { interceptor, index, connections, contextOf } = setUp();
      index.isVerified.mockResolvedValue(false);
      const failure: unknown = await interceptAs(
        interceptor,
        contextOf(JOIN),
        handlerOf(() => of(1)),
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(DomainException);
      expect(failure).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
      expect(connections.acquire).not.toHaveBeenCalled();
    });
  });
});

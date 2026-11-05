import type { IncomingMessage } from 'node:http';
import { Controller, Get, Logger, Module, Param, Post, Req, SetMetadata } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PinoLogger } from 'nestjs-pino';
import type { RequestContext } from '../../src/common/context/request-context.js';
import { bindLogFields } from '../../src/common/logging/bind-log-fields.js';
import { Public } from '../../src/common/security/public.decorator.js';

/** A message with the synthetic markers of 02 §8, as a database or library error can carry. */
export const LEAKY_MESSAGE = 'duplicate key for sara@example.test (secret-value)';

/** Synthetic personal data and a synthetic secret, as a careless log call could pass them. */
export const SYNTHETIC_EMAIL = 'sara@example.test';
export const SYNTHETIC_SECRET_VALUE = 'secret-value';

/** The id of the seed practice `al-noor` (02 §9), as a reviewed log field carries it. */
export const PRACTICE_ID = '00000000-0000-4000-8000-000000000001';

/** Test-only routes under /api/v1/probe; they never exist in src (02 §12). */
@Controller('probe')
class ProbeController {
  constructor(private readonly cls: ClsService<RequestContext>) {}

  /** No @Public(): proves deny-by-default. */
  @Get('protected/:id')
  protectedResource(@Param('id') id: string): { id: string } {
    return { id };
  }

  @Public() // test-only: exposes the request context's id, so a test can compare it with the header
  @Get('context')
  context(): { requestId: string } {
    return { requestId: this.cls.getId() };
  }

  @Public() // test-only: tells how the body parsers read a body, without echoing any of it
  @Post('body')
  body(@Req() req: IncomingMessage & { body?: unknown }): { bodyType: string } {
    return { bodyType: typeof req.body };
  }

  @Public() // test-only: an unknown exception, so a test can check what reaches the logs
  @Get('throws-error')
  throwsError(): never {
    throw new Error(LEAKY_MESSAGE);
  }

  @Public() // test-only: an unknown exception that is not an Error, as a library may throw one
  @Get('throws-string')
  throwsString(): never {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the case under test
    throw LEAKY_MESSAGE;
  }

  @Public() // test-only: an unknown exception shaped like an http-errors error with a hidden message
  @Get('throws-http-error')
  throwsHttpError(): never {
    throw Object.assign(new Error(LEAKY_MESSAGE), { status: 418, statusCode: 418, expose: false });
  }

  @Public() // test-only: an Error whose message is not a string, which the error serializer must survive
  @Get('throws-number-message')
  throwsNumberMessage(): never {
    throw Object.assign(new Error(LEAKY_MESSAGE), { message: 42 });
  }

  @Public() // test-only: an Error whose message getter throws, which the error serializer must survive
  @Get('throws-failing-message')
  throwsFailingMessage(): never {
    const error = new Error(LEAKY_MESSAGE);
    Object.defineProperty(error, 'message', {
      get: (): never => {
        throw new RangeError(LEAKY_MESSAGE);
      },
    });
    throw error;
  }

  @Public() // test-only: an http-errors error whose message getter throws when Nest reads it
  @Get('throws-exposed-failing-message')
  throwsExposedFailingMessage(): never {
    const error = Object.assign(new Error(LEAKY_MESSAGE), {
      status: 418,
      statusCode: 418,
      expose: true,
    });
    Object.defineProperty(error, 'message', {
      get: (): never => {
        throw new RangeError(LEAKY_MESSAGE);
      },
    });
    throw error;
  }

  @Public() // test-only: an Error whose own constructor getter throws when Nest reads it
  @Get('throws-failing-constructor')
  throwsFailingConstructor(): never {
    const error = new Error(LEAKY_MESSAGE);
    Object.defineProperty(error, 'constructor', {
      get: (): never => {
        throw new RangeError(LEAKY_MESSAGE);
      },
    });
    throw error;
  }

  @Public() // test-only: an http-errors error whose status is not an error status, which Express refuses
  @Get('throws-http-error-status/:status')
  throwsHttpErrorStatus(@Param('status') status: string): never {
    const statusCode = Number(status);
    throw Object.assign(new Error(LEAKY_MESSAGE), {
      status: statusCode,
      statusCode,
      expose: false,
    });
  }

  @Public() // test-only: a thrown value whose prototype cannot be read, so instanceof throws on it
  @Get('throws-unreadable-value')
  throwsUnreadableValue(): never {
    const unreadable = new Proxy(
      { message: LEAKY_MESSAGE },
      {
        getPrototypeOf: (): never => {
          throw new RangeError(LEAKY_MESSAGE);
        },
      },
    );
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the case under test
    throw unreadable;
  }
}

/**
 * Test-only routes that log by hand during a request, as feature code might (02 §8): the four
 * calls of the F03 security review that reached a log line, an argument that nestjs-pino turns
 * into the context, and a call with allowed fields only.
 */
@Controller('probe/logs')
class LogProbeController {
  private readonly logger = new Logger(LogProbeController.name);
  // Without a context of its own, nestjs-pino logs the last argument of a call as the context.
  // eslint-disable-next-line medibooker/require-logger-class-name -- the case under test
  private readonly loggerWithoutContext = new Logger();

  constructor(private readonly pinoLogger: PinoLogger) {
    pinoLogger.setContext(LogProbeController.name);
  }

  @Public() // test-only: binds a reviewed field and one that no allowlist names, then logs a line
  @Get('bound-fields')
  boundFields(): { isLogged: true } {
    bindLogFields(this.pinoLogger, { practiceId: PRACTICE_ID, email: SYNTHETIC_EMAIL });
    this.pinoLogger.info('after binding');
    return { isLogged: true };
  }

  @Public() // test-only: an interpolation value, as `logger.log('… %s', value)` passes one
  @Get('format-argument')
  formatArgument(): { isLogged: true } {
    this.logger.log('booked for %s', SYNTHETIC_EMAIL);
    return { isLogged: true };
  }

  @Public() // test-only: personal data three levels down in a logged object
  @Get('nested-object')
  nestedObject(): { isLogged: true } {
    // eslint-disable-next-line medibooker/no-dynamic-log-message -- the case under test
    this.logger.warn({ appointment: { patient: { contact: { email: SYNTHETIC_EMAIL } } } });
    return { isLogged: true };
  }

  @Public() // test-only: an error under another key than `err`, which the error serializer skips
  @Get('error-under-other-key')
  errorUnderOtherKey(@Req() req: IncomingMessage): { isLogged: true } {
    const error = Object.assign(new Error('db'), {
      detail: `Key (email)=(${SYNTHETIC_EMAIL}) already exists.`,
    });
    req.log.error({ error }, 'db failed');
    return { isLogged: true };
  }

  @Public() // test-only: fields that no allowlist names, among them two secrets
  @Get('unlisted-fields')
  unlistedFields(@Req() req: IncomingMessage): { isLogged: true } {
    req.log.info(
      {
        address: `1 ${SYNTHETIC_SECRET_VALUE} street`,
        name: `Sara ${SYNTHETIC_SECRET_VALUE}`,
        mfaSecret: SYNTHETIC_SECRET_VALUE,
        accessToken: SYNTHETIC_SECRET_VALUE,
      },
      'fields',
    );
    return { isLogged: true };
  }

  @Public() // test-only: an e-mail address that nestjs-pino would log as the context
  @Get('argument-as-context')
  argumentAsContext(): { isLogged: true } {
    this.loggerWithoutContext.log('booked for %s', SYNTHETIC_EMAIL);
    return { isLogged: true };
  }

  @Public() // test-only: a reviewed id field and a context, which reach the log line
  @Get('allowed-fields')
  allowedFields(@Req() req: IncomingMessage): { isLogged: true } {
    req.log.info({ practiceId: PRACTICE_ID }, 'practice resolved');
    this.logger.log('plain message');
    return { isLogged: true };
  }
}

/** The former string key of the public marker, which no longer opens a route (02 §4). */
@Controller('probe/string-key-marked')
class StringKeyMarkedProbeController {
  @SetMetadata('medibooker:isPublic', true)
  @Get()
  resource(): { isReachable: true } {
    return { isReachable: true };
  }
}

@Module({
  controllers: [ProbeController, LogProbeController, StringKeyMarkedProbeController],
})
export class ProbeModule {}

import rule from '../../src/plugin/rules/no-dynamic-log-message.js';
import { runTypedRuleTests } from './typed-rule-tester.js';

/** Nest's Logger, imported as the API imports it. */
const NEST = "import { Logger } from '@nestjs/common';\n";

/** Nest's LoggerService interface, which nestjs-pino's Logger implements. */
const LOGGER_SERVICE =
  "import type { LoggerService } from '@nestjs/common';\ndeclare const service: LoggerService;\n";

/** nestjs-pino's PinoLogger, imported as a service injects it. */
const PINO_LOGGER = "import { PinoLogger } from 'nestjs-pino';\n";

const dynamicMessage = { messageId: 'dynamicMessage' };

function errorText(property: 'message' | 'stack') {
  return { messageId: 'errorText', data: { property } };
}

runTypedRuleTests('no-dynamic-log-message', rule, {
  valid: [
    `${NEST}export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  book(): void {
    this.logger.log('plain message');
  }
}`,
    // The supported way to log an error from a service (02 §8): nestjs-pino's PinoLogger with
    // the class name as its context, as UnknownExceptionFilter does.
    `${PINO_LOGGER}export class BookingService {
  constructor(private readonly logger: PinoLogger) {
    logger.setContext(BookingService.name);
  }

  book(): void {
    this.logger.error({ err }, 'booking failed');
    this.logger.info({ practiceId }, 'appointment booked');
  }
}`,
    'logger.info(`appointment booked`);',
    "req.log.info({ practiceId }, 'practice resolved');",
    "logger.error({ err }, 'unknown exception');",
    "pinoLogger.error({ err }, 'unknown exception');",
    `${LOGGER_SERVICE}service.log('plain message');`,
    `${NEST}Logger.log('static call');`,
    "req.log?.info('optional call');",
    "declare const level: 'info' | 'warn';\nlogger[level]('computed method');",
    // No message: the object only, or pino's error as the object, which the message hook names.
    'logger.info({ practiceId });',
    'logger.error(err);',
    'pinoLogger.error(err);',
    // Interpolation values after a constant: the message hook drops them (02 §8).
    `${NEST}new Logger(Probe.name).log('booked for %s', email);`,
    "logger.info('booked for %s', email);",
    "logger.info(null, 'booked for %s', email);",
    "logger.info(undefined, 'booked for %s', email);",
    // A type parameter that can only be an object is the object of the line.
    'export function logFields<T extends object>(fields: T): void {\n  logger.info(fields);\n}',
    // A key named message is no read of an error's message.
    "logger.error({ err: { message: id } }, 'unknown exception');",
    // Not logger calls: no message parameter, a method that may be anything, or no call at all.
    'Math.log(x);',
    'booking.error(id);',
    'declare const handlers: Record<string, (message: string) => void>;\nhandlers[id](message);',
    'booking.error(err.message);',
    'const text = err.message;',
  ],
  invalid: [
    // The calls of the F03 security review that reached a log line.
    { code: 'req.log.info(`booked for ${email}`);', errors: [dynamicMessage] },
    { code: `${NEST}new Logger('Probe').warn(err.message);`, errors: [dynamicMessage] },
    {
      code: `${NEST}new Logger().error(err.message, err.stack);`,
      errors: [dynamicMessage, errorText('stack')],
    },
    {
      code: `${NEST}new Logger(Probe.name).error('Failed to book', err.stack);`,
      errors: [errorText('stack')],
    },
    // Nest's Logger declares the message first, so an object there is its message: an error or
    // fields go through PinoLogger or req.log instead (02 §8).
    {
      code: `${NEST}export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  book(): void {
    this.logger.error({ err }, 'booking failed');
  }
}`,
      errors: [dynamicMessage],
    },
    // A message built at runtime.
    { code: "logger.info('booked for ' + email);", errors: [dynamicMessage] },
    { code: 'logger.info(String(x));', errors: [dynamicMessage] },
    { code: 'logger.info(message);', errors: [dynamicMessage] },
    { code: 'logger.info({ id }, message);', errors: [dynamicMessage] },
    {
      code: `${NEST}new Logger(Probe.name).warn({ appointment: { patient: { email } } });`,
      errors: [dynamicMessage],
    },
    {
      code: 'logger.info({ practiceId }, { email } as unknown as string);',
      errors: [dynamicMessage],
    },
    { code: 'logger.info(42);', errors: [dynamicMessage] },
    { code: 'logger.error({ err }, undefined);', errors: [dynamicMessage] },
    { code: 'pinoLogger.warn(`booked for ${email}`);', errors: [dynamicMessage] },
    { code: `${LOGGER_SERVICE}service.error(message);`, errors: [dynamicMessage] },
    { code: `${NEST}Logger.log(\`booked for \${email}\`);`, errors: [dynamicMessage] },
    { code: 'req.log?.info(message);', errors: [dynamicMessage] },
    {
      code: "declare const level: 'info' | 'warn';\nlogger[level](message);",
      errors: [dynamicMessage],
    },
    { code: 'logger.info(...[message]);', errors: [dynamicMessage] },
    // A first argument that may not be an object: pino takes it as the message.
    { code: 'logger.error(value);', errors: [dynamicMessage] },
    {
      code: 'declare const thrown: string | Error;\nlogger.error(thrown);',
      errors: [dynamicMessage],
    },
    {
      code: 'export function logValue<T>(fields: T): void {\n  logger.info(fields);\n}',
      errors: [dynamicMessage],
    },
    {
      code: 'export function logThrown<T extends string | Error>(thrown: T): void {\n  logger.error(thrown);\n}',
      errors: [dynamicMessage],
    },
    // An error's text anywhere in another argument.
    {
      code: "logger.error({ reason: err.message }, 'booking failed');",
      errors: [errorText('message')],
    },
    {
      code: "logger.error({ reason: String(err?.message) }, 'booking failed');",
      errors: [errorText('message')],
    },
    {
      code: "logger.error({ trace: err['stack'] }, 'booking failed');",
      errors: [errorText('stack')],
    },
    {
      code: "logger.info('booking failed: %s', err.message);",
      errors: [errorText('message')],
    },
  ],
});

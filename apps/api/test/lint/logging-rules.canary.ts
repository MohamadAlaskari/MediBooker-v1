/**
 * Lint canary of the logging rules (02 §8): calls that each rule must report, typed by the
 * installed declarations of @nestjs/common, pino, pino-http and nestjs-pino. The rule tests of
 * @medibooker/eslint-config type their cases with stand-in declarations; this file proves the
 * rules against the real ones. Every call carries a disable comment, and an unused disable
 * comment fails the lint (reportUnusedDisableDirectives), so `pnpm lint` fails when an upgrade
 * renames a parameter or a method and a rule stops reporting. Nothing imports or runs this file.
 */
import type { IncomingMessage } from 'node:http';
import { Logger } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import type { Logger as BaseLogger } from 'pino';

/** Synthetic values, as feature code could pass them to a logger. */
const SYNTHETIC_EMAIL = 'sara@example.test';
const PRACTICE_ID = '00000000-0000-4000-8000-000000000001';

export class LoggingRulesCanary {
  /** Nest's Logger, whose first parameter is `message`. */
  private readonly logger = new Logger(LoggingRulesCanary.name);

  // eslint-disable-next-line medibooker/require-logger-class-name -- canary: proves the rule against the installed declarations
  readonly loggerWithoutContext = new Logger();

  constructor(
    /** nestjs-pino's PinoLogger, whose message parameter is `msg`. */
    private readonly pinoLogger: PinoLogger,
    /** pino's logger, whose LogFn names the message `msg`. */
    private readonly baseLogger: BaseLogger,
  ) {}

  dynamicMessages(req: IncomingMessage, error: Error): void {
    // eslint-disable-next-line medibooker/no-dynamic-log-message -- canary: proves the rule against the installed declarations
    req.log.info(`booked for ${SYNTHETIC_EMAIL}`);
    // eslint-disable-next-line medibooker/no-dynamic-log-message -- canary: proves the rule against the installed declarations
    this.pinoLogger.warn(`booked for ${SYNTHETIC_EMAIL}`);
    // eslint-disable-next-line medibooker/no-dynamic-log-message -- canary: proves the rule against the installed declarations
    this.logger.error('booking failed', error.stack);
  }

  bindings(): BaseLogger {
    // eslint-disable-next-line medibooker/no-log-bindings -- canary: proves the rule against the installed declarations
    this.pinoLogger.assign({ practiceId: PRACTICE_ID });
    // eslint-disable-next-line medibooker/no-log-bindings -- canary: proves the rule against the installed declarations
    return this.baseLogger.child({ practiceId: PRACTICE_ID });
  }
}

import type { EventEmitter } from 'node:events';
import type { Logger } from 'pino';

/**
 * Logs an uncaught exception or an unhandled rejection through the app's pino logger, then exits
 * with code 1 (02 §8). Without a handler Node writes `util.inspect(err)` to stderr, outside pino:
 * the message, the cause and every property, such as a database error's `detail`. The line is at
 * `fatal`, with a constant message and `err` from the error serializer. A failure while logging
 * still exits. `main.ts` registers the handlers after `configureApp`, so a rejected `listen` is
 * logged the same way; `events` is replaceable for tests only.
 */
export function registerProcessHandlers(
  logger: Pick<Logger, 'fatal'>,
  exit: (code: number) => void,
  events: EventEmitter = process,
): void {
  const exitAfter = (log: () => void): void => {
    try {
      log();
    } catch {
      // Nothing more can be logged safely; exiting is what matters now.
    }
    exit(1);
  };
  // Each message is a literal at its call, as the logging rules of 02 §8 require.
  events.on('uncaughtException', (reason: unknown) => {
    exitAfter(() => {
      logger.fatal({ err: reason }, 'uncaught exception');
    });
  });
  events.on('unhandledRejection', (reason: unknown) => {
    exitAfter(() => {
      logger.fatal({ err: reason }, 'unhandled rejection');
    });
  });
}

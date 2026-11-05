// Synthetic violations, one of each logging rule (02 §8).
import { Logger } from '@nestjs/common';
import type { Logger as RequestLogger } from 'pino';

export class BookingNotifier {
  // No context: nestjs-pino would log the last argument of each call as the context.
  private readonly logger = new Logger();

  notify(log: RequestLogger, email: string): void {
    // A message built from a value.
    log.info(`booked for ${email}`);
    // A child logger, whose bindings skip the log-field allowlist.
    log.child({ practiceId: 'p-1' }).info('bound');
    this.logger.log('notified');
  }
}

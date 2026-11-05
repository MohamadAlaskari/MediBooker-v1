// The one place that may bind log fields (02 §8): F04's bindLogFields passes them through the
// field allowlist first.
import type { Logger } from 'pino';

export function bindLogFields(logger: Logger, practiceId: string): Logger {
  return logger.child({ practiceId });
}

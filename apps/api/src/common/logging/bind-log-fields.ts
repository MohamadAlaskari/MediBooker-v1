import type { PinoLogger } from 'nestjs-pino';
import { onlyAllowedFields } from './log-fields.js';

/**
 * Binds reviewed log fields to the rest of the current request (02 §8): every later line of the
 * request and its access line carry them (nestjs-pino `assign`, with `assignResponse` set in
 * pinoOptions). Bindings skip pino's `formatters.log`, so they pass the field allowlist here
 * first: a field it does not name, or whose value lacks the field's form, is dropped and counted
 * in `droppedFields`. Bindings are set only in `common/logging` (`medibooker/no-log-bindings`).
 */
export function bindLogFields(logger: PinoLogger, fields: Readonly<Record<string, unknown>>): void {
  logger.assign(onlyAllowedFields(fields));
}

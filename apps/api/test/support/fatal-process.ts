import { pinoHttp } from 'pino-http';
import { pinoOptions } from '../../src/common/logging/pino-options.js';
import { registerProcessHandlers } from '../../src/common/logging/process-handlers.js';
import { parseEnv } from '../../src/config/env.schema.js';

/**
 * A child process for process-handlers.spec.ts: the API's root logger as main.ts gets it (pino on
 * stdout), the process handlers unless `--without-handlers` is given, and then a failure outside
 * any handler: an uncaught exception (`uncaught`) or an unhandled rejection (`rejection`). The
 * error carries synthetic personal data in its message and in a `detail` property, as a database
 * error does.
 */
const [failure, handlers] = process.argv.slice(2);

const { pinoHttp: options } = pinoOptions(parseEnv({ APP_ENV: 'ci', LOG_LEVEL: 'info' }));
if (options === undefined || Array.isArray(options) || 'write' in options) {
  throw new Error('pino-http options without a destination expected');
}
if (handlers !== '--without-handlers') {
  registerProcessHandlers(pinoHttp(options).logger, (code) => {
    process.exit(code);
  });
}

const error = Object.assign(new Error('duplicate key for sara@example.test (secret-value)'), {
  detail: 'Key (email)=(sara@example.test) already exists.',
});
if (failure === 'rejection') {
  void Promise.reject(error);
} else {
  setTimeout(() => {
    throw error;
  }, 0);
}

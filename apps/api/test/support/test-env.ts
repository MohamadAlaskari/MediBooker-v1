/**
 * The environment of every test app, as raw strings like `process.env` (02 §12). Tests never read
 * the ambient environment. No database variables until F04.
 */
export const TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  APP_ENV: 'ci',
  LOG_LEVEL: 'info',
  // Throttling tests build their own app with a limit of 3.
  RATE_LIMIT_PER_MINUTE: '100000',
};

/**
 * The environment of every test app, as raw strings like `process.env` (02 §12). Tests never read
 * the ambient environment.
 */
export const TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  APP_ENV: 'ci',
  LOG_LEVEL: 'info',
  // Throttling tests build their own app with a limit of 3.
  RATE_LIMIT_PER_MINUTE: '100000',
  // Port 9 refuses every connection: a unit or e2e test never reaches a database (06 §3).
  PLATFORM_DATABASE_URL: 'postgresql://test:test@127.0.0.1:9/none',
  SECRET_STORE: 'dev',
  // Synthetic and of low entropy on purpose, so the staged secret scan has nothing to report.
  DEV_SECRET_SEED: 'synthetic-test-seed',
};

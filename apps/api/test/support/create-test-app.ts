import type { InjectionToken, ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { DestinationStream } from 'pino';
import { AppModule } from '../../src/app.module.js';
import { APP_OPTIONS, configureApp } from '../../src/app.setup.js';
import { Clock } from '../../src/common/time/clock.js';
import { parseEnv } from '../../src/config/env.schema.js';
import { DISCARD_LOGS } from './log-capture.js';
import { TEST_ENV } from './test-env.js';

/** A provider of the app replaced by a value, as `overrideProvider(provide).useValue(useValue)`. */
export interface ProviderOverride {
  readonly provide: InjectionToken;
  readonly useValue: unknown;
}

export interface TestAppOptions {
  /** Raw variables merged over TEST_ENV, then parsed like main.ts does. */
  env?: Readonly<Record<string, string>>;
  /** Test-only modules from test/support, for example ProbeModule. */
  imports?: ModuleMetadata['imports'];
  /** Where this app's logs go; by default they are discarded. */
  logDestination?: DestinationStream;
  /**
   * The app's Clock, for example a FixedClock that the test steps before it calls `evictIdle()`
   * (06 §3). Default: the SystemClock.
   */
  clock?: Clock;
  /** Further replaced providers, for example a SecretStore that knows a test CA. */
  overrides?: readonly ProviderOverride[];
}

// nestjs-pino 5.3.1 builds one pino-http instance per test file (per module graph) on first use
// and keeps it for every later app (its reset function is not exported). A second app in the same
// file would therefore write to the first app's destination and keep its log options. Every test
// app writes to this one forwarding destination instead, which hands the lines to the newest app's
// destination; and an app that asks for other log options than the file's first app is refused,
// because it would silently log with the first app's options.
let currentDestination: DestinationStream = DISCARD_LOGS;
const forwardingDestination: DestinationStream = {
  write: (line) => {
    currentDestination.write(line);
  },
};
let logOptionsOfFile: string | undefined;

/**
 * Builds the app like main.ts does (02 §12): AppModule.forRoot with a parsed environment,
 * APP_OPTIONS and configureApp, plus test-only modules and replaced providers; then init()
 * without listening. Close it in afterAll. Logs go to the most recently created app's
 * destination; LOG_LEVEL and LOG_PRETTY are those of the file's first app.
 */
export async function createTestApp({
  env = {},
  imports = [],
  logDestination = DISCARD_LOGS,
  clock,
  overrides = [],
}: TestAppOptions = {}): Promise<NestExpressApplication> {
  const parsedEnv = parseEnv({ ...TEST_ENV, ...env });
  const logOptions = `LOG_LEVEL=${parsedEnv.LOG_LEVEL} LOG_PRETTY=${String(parsedEnv.LOG_PRETTY)}`;
  logOptionsOfFile ??= logOptions;
  if (logOptions !== logOptionsOfFile) {
    throw new Error(
      `nestjs-pino keeps the logger of the first app in a test file (${logOptionsOfFile}); ` +
        `an app with ${logOptions} needs a test file of its own`,
    );
  }
  currentDestination = logDestination;
  let builder = Test.createTestingModule({
    imports: [AppModule.forRoot(parsedEnv, { logDestination: forwardingDestination }), ...imports],
  });
  const replaced =
    clock === undefined ? overrides : [{ provide: Clock, useValue: clock }, ...overrides];
  for (const { provide, useValue } of replaced) {
    builder = builder.overrideProvider(provide).useValue(useValue);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS);
  configureApp(app, parsedEnv);
  await app.init();
  return app;
}

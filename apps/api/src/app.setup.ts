import {
  type NestApplicationOptions,
  type VersioningOptions,
  VersioningType,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { requestContextMiddleware } from './common/context/request-context.js';
import { REQUEST_ID_HEADER } from './common/context/request-id.js';
import type { Env } from './config/env.schema.js';

/**
 * Shared by main.ts and createTestApp (and the OpenAPI generator, X02), so all of them run the same
 * middleware stack: the body parser is added by configureApp with its limit, and boot logs wait for
 * the pino logger.
 */
export const APP_OPTIONS = { bodyParser: false, bufferLogs: true } satisfies NestApplicationOptions;

/**
 * Versioned routes live under `/api/v<version>`, version 1 when a route names none; a route can be
 * version-neutral instead (the health probes). Also read by the route inventory test.
 */
export const API_VERSIONING = {
  type: VersioningType.URI,
  prefix: 'api/v',
  defaultVersion: '1',
} as const satisfies VersioningOptions;

/** Applies the HTTP setup of 02 §3, in this order. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  // 1. The request context first, so every response carries X-Request-Id: also a 404, a CORS
  //    preflight and a body-parser rejection.
  app.use(requestContextMiddleware());

  // 2. Versioned routes live under /api/v1. No global prefix: Nest would also prefix the module
  //    middleware (the access log), and a request outside /api would go unlogged.
  app.enableVersioning(API_VERSIONING);

  // 3. req.ip, the throttling key, from the configured number of proxy hops only.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  // 4. Also removed by helmet; disabled explicitly so it never comes back.
  app.disable('x-powered-by');

  // 5. Security headers for a JSON API. X02 relaxes the CSP on /api/docs when the UI is enabled.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
    }),
  );

  // 6. CORS only for an explicit allowlist; the web is same-origin behind the proxy. A01 decides
  //    `credentials` together with cookies and CSRF.
  if (env.CORS_ORIGINS.length > 0) {
    app.enableCors({
      origin: env.CORS_ORIGINS,
      exposedHeaders: [REQUEST_ID_HEADER, 'Retry-After'],
    });
  }

  // 7. JSON bodies up to 100 kB; the urlencoded parser stays off.
  app.useBodyParser('json', { limit: '100kb' });

  // 8.
  app.enableShutdownHooks();
  app.useLogger(app.get(Logger));
}

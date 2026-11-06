import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type NestApplicationOptions,
  type VersioningOptions,
  VersioningType,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { requestContextMiddleware } from './common/context/request-context.js';
import { REQUEST_ID_HEADER } from './common/context/request-id.js';
import { jsonOnly } from './common/errors/json-only.middleware.js';
import type { Env } from './config/env.schema.js';
import { buildOpenApiDocument, OPENAPI_UI_PATH } from './openapi/document.js';

/**
 * Shared by main.ts, createTestApp and the OpenAPI generator: the body parser is added by
 * configureApp with its limit, and boot logs wait for the pino logger.
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

  // 5. Security headers for a JSON API; the Swagger UI, when enabled, needs its own scripts.
  const apiHeaders = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
  });
  if (env.OPENAPI_UI_ENABLED) {
    const docsHeaders = helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          frameAncestors: ["'none'"],
        },
      },
    });
    app.use((request: IncomingMessage, response: ServerResponse, next: () => void) => {
      const isDocs = request.url?.startsWith(`/${OPENAPI_UI_PATH}`) === true;
      (isDocs ? docsHeaders : apiHeaders)(request, response, next);
    });
  } else {
    app.use(apiHeaders);
  }

  // 6. CORS only for an explicit allowlist; the web is same-origin behind the proxy, and its
  //    cookies are SameSite=Strict, so no other origin gets `credentials`.
  if (env.CORS_ORIGINS.length > 0) {
    app.enableCors({
      origin: env.CORS_ORIGINS,
      exposedHeaders: [REQUEST_ID_HEADER, 'Retry-After'],
    });
  }

  // 7. JSON bodies up to 100 kB and nothing else; the urlencoded parser stays off.
  app.use(jsonOnly);
  app.useBodyParser('json', { limit: '100kb' });

  // 8.
  app.enableShutdownHooks();
  app.useLogger(app.get(Logger));

  // 9. The Swagger UI, only when enabled: never in production (env.schema.ts refuses it there).
  if (env.OPENAPI_UI_ENABLED) {
    SwaggerModule.setup(OPENAPI_UI_PATH, app, buildOpenApiDocument(app));
  }
}

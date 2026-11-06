/**
 * `pnpm generate`: writes apps/api/openapi.json from the built app (02 §11). The Prisma clients
 * connect lazily, so no database is touched; the placeholder values below only pass parseEnv.
 */
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module.js';
import { API_VERSIONING, APP_OPTIONS } from '../app.setup.js';
import { parseEnv } from '../config/env.schema.js';
import { buildOpenApiDocument, serializeOpenApiDocument } from './document.js';

const PLACEHOLDER_ENV = {
  NODE_ENV: 'test',
  APP_ENV: 'ci',
  PLATFORM_DATABASE_URL: 'postgresql://changeme:changeme@127.0.0.1:9/changeme',
  SECRET_STORE: 'dev',
  DEV_SECRET_SEED: 'placeholder',
};

const app = await NestFactory.create<NestExpressApplication>(
  AppModule.forRoot(parseEnv(PLACEHOLDER_ENV)),
  { ...APP_OPTIONS, logger: false },
);
app.enableVersioning(API_VERSIONING);
const document = buildOpenApiDocument(app);
await app.close();
writeFileSync(new URL('../../openapi.json', import.meta.url), serializeOpenApiDocument(document));

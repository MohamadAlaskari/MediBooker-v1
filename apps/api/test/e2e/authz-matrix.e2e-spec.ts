import type { NestExpressApplication } from '@nestjs/platform-express';
import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../src/openapi/document.js';
import { createTestApp } from '../support/create-test-app.js';
import { AUTHZ_MATRIX } from '../integration/authz/matrix.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

/** Where the document serves an operation. */
function routeOf(
  document: OpenAPIObject,
  operationId: string,
): { method: HttpMethod; path: string } {
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      if (item[method]?.operationId === operationId) return { method, path };
    }
  }
  throw new Error(`no route for ${operationId}`);
}

describe('the protected operations (06 §4)', () => {
  let app: NestExpressApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    app = await createTestApp();
    document = buildOpenApiDocument(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(Object.keys(AUTHZ_MATRIX))('%s answers 401 without a sign-in', async (operationId) => {
    const { method, path } = routeOf(document, operationId);
    const response = await request(app.getHttpServer())
      [method](path)
      .send({})
      .expect('Content-Type', /application\/problem\+json/u);
    expect(response.status).toBe(401);
  });
});

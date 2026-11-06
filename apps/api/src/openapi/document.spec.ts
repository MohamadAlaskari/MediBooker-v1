import type { OpenAPIObject } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLIC_OPERATIONS } from '../../test/integration/authz/matrix.js';
import { createTestApp } from '../../test/support/create-test-app.js';
import { operationIdsOf, serializeOpenApiDocument, buildOpenApiDocument } from './document.js';

interface OperationResponses {
  responses: Record<string, { content?: Record<string, unknown> }>;
}

/** The operationIds of a document that no registry knows (06, 02 §11). */
function unregisteredOperations(document: OpenAPIObject, registered: readonly string[]): string[] {
  return operationIdsOf(document).filter((id) => !registered.includes(id));
}

describe('the OpenAPI document (X02)', () => {
  let app: NestExpressApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    app = await createTestApp();
    document = buildOpenApiDocument(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('declares OpenAPI 3.1.0 and serves the practice page under /api/v1', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toContain('/api/v1/public/practices/{slug}');
  });

  it('leaves the infrastructure probes out of the contract', () => {
    expect(Object.keys(document.paths).filter((path) => path.startsWith('/health'))).toEqual([]);
  });

  it('has unique operationIds', () => {
    const ids = operationIdsOf(document);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('documents the ProblemDetails responses of a public, practice-scoped operation', () => {
    const operation = document.paths['/api/v1/public/practices/{slug}']?.get as
      OperationResponses | undefined;
    const statuses = Object.keys(operation?.responses ?? {}).sort();
    expect(statuses).toEqual(['200', '400', '404', '429', '500', '503']);
    expect(operation?.responses['404']?.content).toHaveProperty(['application/problem+json']);
  });

  it('declares the error codes and field codes as named enums', () => {
    const schemas = JSON.stringify(document.components?.schemas);
    expect(schemas).toContain('SERVICE_UNAVAILABLE');
    expect(schemas).toContain('UNKNOWN_FIELD');
    expect(document.components?.schemas).toHaveProperty('ErrorCode');
    expect(document.components?.schemas).toHaveProperty('FieldErrorCode');
  });

  it('serializes byte-identically, whatever the order of the keys', () => {
    const shuffled = { ...document, info: document.info, openapi: document.openapi };
    expect(serializeOpenApiDocument(shuffled)).toBe(serializeOpenApiDocument(document));
    expect(serializeOpenApiDocument(document).endsWith('}\n')).toBe(true);
  });

  it('registers every operation for the authorization matrix', () => {
    expect(unregisteredOperations(document, PUBLIC_OPERATIONS)).toEqual([]);
  });

  it('fails for an operation that no registry knows', () => {
    const fixture = {
      ...document,
      paths: {
        ...document.paths,
        '/api/v1/fixture': { get: { operationId: 'fixtureOperation', responses: {} } },
      },
    };
    expect(unregisteredOperations(fixture, PUBLIC_OPERATIONS)).toEqual(['fixtureOperation']);
  });
});

import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { ProblemDetailsDto } from '../common/errors/problem-details.dto.js';

/** Where the Swagger UI is served when OPENAPI_UI_ENABLED is true. */
export const OPENAPI_UI_PATH = 'api/docs';

const PUBLIC_PATH_PREFIX = '/api/v1/public/';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

/** One operation of a document, as far as this file reads and writes it. */
interface Operation {
  operationId?: string;
  responses: Record<string, unknown>;
}

function operationsOf(document: OpenAPIObject): (readonly [string, Operation])[] {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    HTTP_METHODS.flatMap((method) => {
      const operation = item[method] as Operation | undefined;
      return operation === undefined ? [] : [[path, operation] as const];
    }),
  );
}

const PROBLEM_RESPONSE = {
  description: 'An error, as application/problem+json',
  content: {
    'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetailsDto' } },
  },
};

/** The statuses every operation can answer, by what its path says about it (05 §1.5). */
function errorStatusesOf(path: string): string[] {
  const isPublic = path.startsWith(PUBLIC_PATH_PREFIX);
  const isPracticeScoped = path.includes('{practiceId}') || (isPublic && path.includes('{slug}'));
  return [
    '400',
    '429',
    '500',
    ...(isPublic ? [] : ['401', '403']),
    ...(isPracticeScoped ? ['404', '503'] : []),
  ];
}

/**
 * The OpenAPI 3.1 document of an app, without a database. The app must have its versioning enabled.
 * Every operation gets its method's name as operationId and the ProblemDetails responses.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setOpenAPIVersion('3.1.0')
    .setTitle('MediBooker API')
    .addBearerAuth()
    .addCookieAuth('mb_access')
    .setVersion('1')
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controller, method) => method,
    extraModels: [ProblemDetailsDto],
  });
  for (const [path, operation] of operationsOf(document)) {
    for (const status of errorStatusesOf(path)) operation.responses[status] = PROBLEM_RESPONSE;
  }
  return document;
}

/** The operationIds of a document, in its order. */
export function operationIdsOf(document: OpenAPIObject): string[] {
  return operationsOf(document).map(([, operation]) => operation.operationId ?? '');
}

/** A value with the keys of every object sorted, and arrays as they are. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, child]) => [key, sortKeys(child)]),
  );
}

/** The committed form of a document: sorted keys, so two runs are byte-identical. */
export function serializeOpenApiDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(sortKeys(document), null, 2)}\n`;
}

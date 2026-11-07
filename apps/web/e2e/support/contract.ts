/**
 * Holds what crosses the proxy in a test against the OpenAPI document and the schemas generated from
 * it: that the route exists, that a page sends what the API takes, and that the stub answers what the
 * API answers. A stub that drifts from the contract would make every page test prove nothing.
 */
import { readFileSync } from 'node:fs';
import * as generated from '@medibooker/api-client/zod';
import type { Request } from '@playwright/test';
import * as zod from 'zod';

interface Operation {
  readonly method: string;
  readonly path: RegExp;
  readonly body: zod.ZodType | undefined;
  readonly answer: zod.ZodType | undefined;
}

interface OpenApi {
  readonly paths: Readonly<Record<string, Readonly<Record<string, { operationId: string }>>>>;
}

const SCHEMAS = generated as unknown as Readonly<Record<string, zod.ZodType | undefined>>;

const OPEN_API = JSON.parse(
  readFileSync(new URL('../../../api/openapi.json', import.meta.url), 'utf8'),
) as OpenApi;

function schemaName(operationId: string, part: 'Body' | 'Response'): string {
  return `${operationId.charAt(0).toUpperCase()}${operationId.slice(1)}${part}`;
}

const OPERATIONS: readonly Operation[] = Object.entries(OPEN_API.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, { operationId }]) => ({
    method: method.toUpperCase(),
    path: new RegExp(`^${path.replaceAll(/\{[^}]+\}/g, '[^/]+')}$`),
    body: SCHEMAS[schemaName(operationId, 'Body')],
    answer: SCHEMAS[schemaName(operationId, 'Response')],
  })),
);

const PROBLEM = zod.object({
  type: zod.string(),
  title: zod.string(),
  status: zod.number(),
  detail: zod.string(),
  code: zod.string(),
  requestId: zod.string(),
});

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function issuesOf(schema: zod.ZodType, value: unknown): string | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? undefined : zod.prettifyError(parsed.error);
}

function answerIssues(operation: Operation, status: number, text: string): string | undefined {
  const isSuccess = status >= 200 && status < 300;
  if (!isSuccess) {
    const issues = issuesOf(PROBLEM, jsonOf(text));
    if (issues !== undefined) return issues;
    const { status: stated } = PROBLEM.parse(jsonOf(text));
    return stated === status ? undefined : `the problem says ${String(stated)}`;
  }
  // A void schema has nothing to say about an answer without a body.
  if (operation.answer === undefined || text === '') return undefined;
  return issuesOf(operation.answer, jsonOf(text));
}

/** What differs from the contract in one request and its answer, in words. */
export function differencesFromContract(
  request: Request,
  status: number,
  text: string,
): readonly string[] {
  const { pathname } = new URL(request.url());
  const name = `${request.method()} ${pathname}`;
  const operation = OPERATIONS.find(
    ({ method, path }) => method === request.method() && path.test(pathname),
  );
  if (operation === undefined) return [`${name}: the API has no such route`];
  const sent =
    operation.body === undefined ? undefined : issuesOf(operation.body, request.postDataJSON());
  const answered = answerIssues(operation, status, text);
  return [
    ...(sent === undefined ? [] : [`${name} sent: ${sent}`]),
    ...(answered === undefined ? [] : [`${name} answered ${String(status)}: ${answered}`]),
  ];
}

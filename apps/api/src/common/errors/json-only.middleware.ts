import type { IncomingMessage, ServerResponse } from 'node:http';
import { UnsupportedMediaTypeException } from '@nestjs/common';

const METHODS_WITH_BODY: ReadonlySet<string | undefined> = new Set(['POST', 'PUT', 'PATCH']);

function hasBody(request: IncomingMessage): boolean {
  const { 'content-length': length, 'transfer-encoding': encoding } = request.headers;
  return encoding !== undefined || (length !== undefined && length !== '0');
}

function isJson(contentType: string | undefined): boolean {
  return contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

/**
 * Answers 415 for a body that is not JSON (05 §1): the JSON parser would skip it silently, and the
 * handler would then see no body at all. A request without a body passes.
 */
export function jsonOnly(
  request: IncomingMessage,
  _response: ServerResponse,
  next: (error?: unknown) => void,
): void {
  const unsupported =
    METHODS_WITH_BODY.has(request.method) &&
    hasBody(request) &&
    !isJson(request.headers['content-type']);
  next(unsupported ? new UnsupportedMediaTypeException() : undefined);
}

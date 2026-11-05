import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

/** The response header that carries the request id. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** The parts of a Node request that the request id needs. */
export interface IdentifiableRequest {
  id?: unknown;
  readonly headers: IncomingHttpHeaders;
}

const UUID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True for a string in the 8-4-4-4-12 hex form of a UUID: the form of a request id and of the ids
 * the API logs (`practiceId`). Only this form reaches a log line, so a field that should hold an
 * id can never carry other text.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_FORM.test(value);
}

/**
 * The request id (02 §4): an inbound `X-Request-Id` in the 8-4-4-4-12 hex form is kept in
 * lowercase; anything else (missing, malformed, or several headers that Node joined with commas)
 * is replaced by a random UUID. Computed once and stored on `req.id`, so the request context,
 * the response header and the access log carry the same id.
 */
export function requestIdOf(req: IdentifiableRequest): string {
  if (typeof req.id === 'string') return req.id;
  const inbound = req.headers['x-request-id'];
  const id = isUuid(inbound) ? inbound.toLowerCase() : randomUUID();
  req.id = id;
  return id;
}

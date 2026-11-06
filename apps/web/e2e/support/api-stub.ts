/**
 * Stands in for the API in the end-to-end tests: `node e2e/support/api-stub.ts`. It answers like the
 * contract: a practice as JSON, anything else as problem+json with a request id. It also tells the
 * tests which visitor addresses reached it.
 */
import { createServer, type ServerResponse } from 'node:http';
import { PRACTICES } from './practices.ts';

const LIST_PATH = '/api/v1/public/practices';
const PATH = /^\/api\/v1\/public\/practices\/([^/]+)$/;
// A Map and a type check: the slug comes from the URL, and `__proto__` is no practice.
const PRACTICE_BY_SLUG = new Map(Object.entries(PRACTICES));
const forwardedFor = new Set<string>();

const LISTED = ['al-noor', 'ocean', 'closed'];
/** Smaller than the list, so the tests see the web walk through the pages. */
const LIST_PAGE_SIZE = 2;

function list(response: ServerResponse, cursor: string | null): void {
  const start = cursor === null ? 0 : Number(cursor);
  const end = start + LIST_PAGE_SIZE;
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(
    JSON.stringify({
      items: LISTED.slice(start, end).map((slug) => ({ slug })),
      nextCursor: end < LISTED.length ? String(end) : null,
    }),
  );
}

function problem(response: ServerResponse, status: number, code: string): void {
  response.writeHead(status, { 'Content-Type': 'application/problem+json' });
  response.end(
    JSON.stringify({
      type: `urn:medibooker:problem:${code.toLowerCase().replaceAll('_', '-')}`,
      title: code,
      status,
      detail: code,
      code,
      requestId: '30000000-0000-4000-8000-000000000001',
    }),
  );
}

const server = createServer((request, response) => {
  const url = request.url ?? '';
  if (url === '/health') {
    response.end('ok');
    return;
  }
  if (url === '/__forwarded-for') {
    response.end(JSON.stringify([...forwardedFor]));
    return;
  }
  const visitor = request.headers['x-forwarded-for'];
  if (typeof visitor === 'string') forwardedFor.add(visitor);
  const { pathname, searchParams } = new URL(url, 'http://stub');
  if (pathname === LIST_PATH) {
    list(response, searchParams.get('cursor'));
    return;
  }
  const slug = PATH.exec(url)?.[1] ?? '';
  if (slug === 'broken') {
    problem(response, 503, 'SERVICE_UNAVAILABLE');
    return;
  }
  const practice = PRACTICE_BY_SLUG.get(slug);
  if (typeof practice !== 'function') {
    problem(response, 404, 'NOT_FOUND');
    return;
  }
  const language = request.headers['accept-language'] ?? 'ar';
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(practice(language)));
});

server.listen(Number(process.env.API_STUB_PORT ?? 3901), '127.0.0.1');

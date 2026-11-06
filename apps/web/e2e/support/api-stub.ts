/**
 * Stands in for the API in the end-to-end tests: `node e2e/support/api-stub.ts`. It answers like the
 * contract: a practice as JSON, anything else as problem+json with a request id. It also tells the
 * tests which visitor addresses reached it.
 */
import { createServer, type ServerResponse } from 'node:http';
import { PRACTICES } from './practices.ts';

const PATH = /^\/api\/v1\/public\/practices\/([^/]+)$/;
const forwardedFor = new Set<string>();

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
  const slug = PATH.exec(url)?.[1] ?? '';
  if (slug === 'broken') {
    problem(response, 503, 'SERVICE_UNAVAILABLE');
    return;
  }
  const practice = PRACTICES[slug];
  if (practice === undefined) {
    problem(response, 404, 'NOT_FOUND');
    return;
  }
  const language = request.headers['accept-language'] ?? 'ar';
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(practice(language)));
});

server.listen(Number(process.env.API_STUB_PORT ?? 3901), '127.0.0.1');

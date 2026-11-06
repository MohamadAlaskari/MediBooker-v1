/**
 * Stands in for the API in the end-to-end tests: `node e2e/support/api-stub.ts`. It answers like the
 * contract: a practice as JSON, anything else as problem+json with a request id. It also tells the
 * tests which visitor addresses reached it.
 */
import { createServer, type ServerResponse } from 'node:http';
import { handleAccounts } from './auth-stub.ts';
import { PRACTICES } from './practices.ts';

const LIST_PATH = '/api/v1/public/practices';
const PATH = /^\/api\/v1\/public\/practices\/([^/]+)$/;
const FREE_TIMES_PATH = /^\/api\/v1\/public\/practices\/([^/]+)\/(availability|slots)$/;
// A Map and a type check: the slug comes from the URL, and `__proto__` is no practice.
const PRACTICE_BY_SLUG = new Map(Object.entries(PRACTICES));
const forwardedFor = new Set<string>();

/** The stub's today; the practices say the same, so no test depends on the clock. */
const TODAY = Date.UTC(2026, 10, 8);
const DAY_MS = 86_400_000;
const AVAILABILITY_DAYS = 42;
const ISO_FRIDAY = 5;
const ISO_SATURDAY = 6;
const CLOSED_DAY = '2026-11-19';
/** Local 09:00, 09:30 and 16:00 in Riyadh, and only the second for a chosen doctor. */
const TIMES_UTC = ['06:00', '06:30', '13:00'];

function json(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function availability(response: ServerResponse, slug: string): void {
  const days = Array.from({ length: AVAILABILITY_DAYS }, (_, offset) => {
    const day = new Date(TODAY + offset * DAY_MS);
    const date = day.toISOString().slice(0, 10);
    const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    const closed = weekday === ISO_FRIDAY || weekday === ISO_SATURDAY || date === CLOSED_DAY;
    return { date, hasFreeTimes: slug !== 'no-times' && !closed };
  });
  json(response, { days });
}

function freeTimes(response: ServerResponse, date: string, providerId: string | null): void {
  const hours = providerId === null ? TIMES_UTC : TIMES_UTC.slice(1, 2);
  json(response, {
    date,
    times: hours.map((time) => ({ startsAt: `${date}T${time}:00Z` })),
  });
}

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
  if (handleAccounts(pathname, searchParams, request, response)) return;
  if (pathname === LIST_PATH) {
    list(response, searchParams.get('cursor'));
    return;
  }
  const times = FREE_TIMES_PATH.exec(pathname);
  if (times !== null) {
    const [, slug = '', route] = times;
    if (route === 'availability') availability(response, slug);
    else freeTimes(response, searchParams.get('date') ?? '', searchParams.get('providerId'));
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

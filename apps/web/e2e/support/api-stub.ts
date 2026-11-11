/**
 * Stands in for the API in the end-to-end tests: `node e2e/support/api-stub.ts`. It answers like the
 * contract: a practice as JSON, anything else as problem+json with a request id. It also tells the
 * tests which visitor addresses reached it.
 */
import { createServer, type ServerResponse } from 'node:http';
import type { PublicPracticeDto } from '@medibooker/api-client';
import { problem, respond } from './answers.ts';
import { deskAccessOf, handleAccounts, ownerOf } from './auth-stub.ts';
import { freeStarts, handleBooking, isOffered, publicPracticeFor } from './booking-stub.ts';
import { handleDesk } from './desk-stub.ts';
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
const PRACTICE_RETRY_AFTER_SECONDS = '30';

const LISTED = ['al-noor', 'ocean', 'closed'];
/** Smaller than the list, so the tests see the web walk through the pages. */
const LIST_PAGE_SIZE = 2;

function list(response: ServerResponse, cursor: string | null): void {
  const start = cursor === null ? 0 : Number(cursor);
  const end = start + LIST_PAGE_SIZE;
  respond(response, 200, {
    items: LISTED.slice(start, end).map((slug) => ({ slug })),
    nextCursor: end < LISTED.length ? String(end) : null,
  });
}

function freeTimes(
  response: ServerResponse,
  route: string | undefined,
  practice: PublicPracticeDto,
  owner: string | undefined,
  searchParams: URLSearchParams,
): void {
  const providerId = searchParams.get('providerId');
  if (!isOffered(owner, practice, searchParams.get('serviceId'), providerId)) {
    problem(response, 'NOT_FOUND');
    return;
  }
  const startsOf = (date: string): readonly string[] =>
    freeStarts(owner, practice, date, providerId);
  if (route === 'availability') {
    const days = Array.from({ length: AVAILABILITY_DAYS }, (_, offset) => {
      const date = new Date(TODAY + offset * DAY_MS).toISOString().slice(0, 10);
      return { date, hasFreeTimes: startsOf(date).length > 0 };
    });
    respond(response, 200, { days });
    return;
  }
  const date = searchParams.get('date') ?? '';
  respond(response, 200, { date, times: startsOf(date).map((startsAt) => ({ startsAt })) });
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
  const owner = ownerOf(request);
  if (handleBooking(owner, pathname, searchParams, request, response)) return;
  if (handleDesk(pathname, searchParams, request, response, () => deskAccessOf(request))) return;
  if (handleAccounts(pathname, searchParams, request, response)) return;
  // Everything public only reads.
  if (request.method !== 'GET') {
    problem(response, 'NOT_FOUND');
    return;
  }
  if (pathname === LIST_PATH) {
    list(response, searchParams.get('cursor'));
    return;
  }
  const [, slugOfTimes = '', route] = FREE_TIMES_PATH.exec(pathname) ?? [];
  const slug = PATH.exec(pathname)?.[1] ?? slugOfTimes;
  if (slug === 'broken') {
    problem(response, 'SERVICE_UNAVAILABLE', {}, { 'Retry-After': PRACTICE_RETRY_AFTER_SECONDS });
    return;
  }
  const answer = PRACTICE_BY_SLUG.get(slug);
  if (typeof answer !== 'function') {
    problem(response, 'NOT_FOUND');
    return;
  }
  const language = request.headers['accept-language'] ?? 'ar';
  const practice = answer(language);
  if (slugOfTimes !== '') {
    freeTimes(response, route, practice, owner, searchParams);
    return;
  }
  respond(response, 200, publicPracticeFor(owner, practice));
});

server.listen(Number(process.env.API_STUB_PORT ?? 3901), '127.0.0.1');

import { describe, expect, it, vi } from 'vitest';
import { allPassed, healthChecks, runChecks, smokeChecks, type Check } from './checks.ts';
import { DEMO_SERVICE, STACKS } from './stacks.ts';

interface Route {
  readonly status: number;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** A route that answers differently each time, as a limit that counts down does. */
type Routes = Readonly<Record<string, Route | (() => Route)>>;

function answering(routes: Routes): typeof fetch {
  return vi.fn((input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    const entry = routes[url];
    if (entry === undefined) return Promise.reject(new Error(`No route for ${url}`));
    const route = typeof entry === 'function' ? entry() : entry;
    return Promise.resolve(
      new Response(route.body ?? '', {
        status: route.status,
        ...(route.headers === undefined ? {} : { headers: route.headers }),
      }),
    );
  });
}

/** The name of a smoke run in these tests, which is part of the address it signs up with. */
const RUN_ID = 'test';
const mailAddress = (locale: string): string => `smoke-${RUN_ID}-${locale}@example.test`;
const WITH_MAILPIT = { swaggerEnabled: false, catchesMail: true };

const mailSearchUrl = (mailUrl: string, locale: string): string =>
  `${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${mailAddress(locale)}`)}`;
const mailFound = (locale: string) => ({
  status: 200,
  body: `{"messages":[{"To":[{"Address":"${mailAddress(locale)}"}]}]}`,
});

const freeTimesUrl = (apiUrl: string): string =>
  `${apiUrl}/api/v1/public/practices/al-noor/availability?serviceId=${DEMO_SERVICE}`;

const DEMO_PRACTICE_ANSWER = { status: 200, body: '{"slug":"al-noor"}' };

function limitCountingDown(): () => Route {
  let remaining = 60;
  return () => {
    remaining -= 1;
    return {
      ...DEMO_PRACTICE_ANSWER,
      headers: { 'x-ratelimit-remaining': String(remaining) },
    };
  };
}

/** Everything a healthy stack answers, by the URLs of its checks. */
function healthyRoutes(mode: 'dev' | 'prod'): Routes {
  const { apiProbeUrl, webProbeUrl, webUrl, apiUrl, mailUrl } = STACKS[mode];
  const page = (direction: string) => ({
    status: 200,
    body: `<html dir="${direction}">`,
    headers: { 'content-security-policy': "script-src 'self' 'nonce-abc'" },
  });
  return {
    [`${apiProbeUrl}/health/live`]: { status: 200 },
    [`${apiProbeUrl}/health/ready`]: { status: 200 },
    [`${webProbeUrl}/healthz`]: { status: 200 },
    [`${mailUrl}/livez`]: { status: 200 },
    [`${apiUrl}/api/v1/auth/register`]: { status: 202 },
    [mailSearchUrl(mailUrl, 'ar')]: mailFound('ar'),
    [mailSearchUrl(mailUrl, 'en')]: mailFound('en'),
    [`${webUrl}/`]: { status: 307, headers: { location: '/en' } },
    [`${webUrl}/en`]: page('ltr'),
    [`${webUrl}/ar`]: page('rtl'),
    [`${webUrl}/en/al-noor`]: {
      status: 200,
      body: '<h1>Al Noor</h1><script type="application/ld+json">{}</script>',
    },
    [`${webUrl}/sitemap.xml`]: {
      status: 200,
      body: `<url><loc>${webUrl}/en/al-noor</loc></url>`,
    },
    [`${apiUrl}/api/v1/public/practices/al-noor`]: limitCountingDown(),
    [freeTimesUrl(apiUrl)]: { status: 200, body: '{"days":[{"hasFreeTimes":true}]}' },
    [`${apiUrl}/api/v1/public/practices/gibt-es-nicht`]: {
      status: 404,
      headers: {
        'content-type': 'application/problem+json',
        'x-request-id': 'chosen-by-the-proxy',
      },
    },
    // In development the probes and the Swagger UI answer; behind the proxy they do not.
    ...(mode === 'dev'
      ? { [`${apiProbeUrl}/api/docs`]: { status: 200 } }
      : {
          [`${webUrl}/health/ready`]: { status: 404 },
          [`${webUrl}/healthz`]: { status: 404 },
          [`${apiUrl}/api/docs`]: { status: 404 },
        }),
  };
}

describe('runChecks', () => {
  const check: Check = {
    name: 'Probe',
    url: 'http://test/a',
    hint: 'Do something',
    verify: ({ status }) => (status === 200 ? undefined : 'Not fine'),
  };

  it('reports a passed check without a problem', async () => {
    const [result] = await runChecks([check], answering({ 'http://test/a': { status: 200 } }));
    expect(result).toEqual({
      name: 'Probe',
      url: 'http://test/a',
      ok: true,
      problem: '',
      hint: 'Do something',
      advisory: false,
    });
  });

  it('reports the problem of a failed check', async () => {
    const [result] = await runChecks([check], answering({ 'http://test/a': { status: 500 } }));
    expect(result).toMatchObject({ ok: false, problem: 'Not fine' });
  });

  it('treats an unreachable service as a failed check, not as a crash', async () => {
    const [result] = await runChecks([check], answering({}));
    expect(result).toMatchObject({ ok: false, problem: 'Nicht erreichbar' });
  });

  it('never follows a redirect and sends the headers of the check', async () => {
    const fetchImpl = answering({ 'http://test/a': { status: 200 } });
    await runChecks([{ ...check, headers: { 'Accept-Language': 'en' } }], fetchImpl);
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[1]).toMatchObject({
      redirect: 'manual',
      headers: { 'Accept-Language': 'en' },
    });
  });

  it('sends the method and the body of a check', async () => {
    const fetchImpl = answering({ 'http://test/a': { status: 200 } });
    await runChecks([{ ...check, method: 'POST', body: '{}' }], fetchImpl);
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: '{}' });
  });

  it('asks again for what happens in the background, until it has happened', async () => {
    const statuses = [500, 500, 200, 500];
    const fetchImpl = answering({
      'http://test/a': () => ({ status: statuses.shift() ?? 500 }),
    });
    const [result] = await runChecks([{ ...check, attempts: 5 }], fetchImpl, 0);
    expect(result?.ok).toBe(true);
    expect(statuses).toEqual([500]);
  });

  it('gives up after its attempts', async () => {
    const fetchImpl = answering({ 'http://test/a': { status: 500 } });
    const [result] = await runChecks([{ ...check, attempts: 2 }], fetchImpl, 0);
    expect(result?.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('a fresh database without demo practices', () => {
  const routes = {
    ...healthyRoutes('prod'),
    'http://localhost:8080/api/v1/public/practices/al-noor': { status: 404 },
  };

  it('is no error for the health entry', async () => {
    const results = await runChecks(healthChecks(STACKS.prod), answering(routes));
    expect(results.find(({ ok }) => !ok)).toMatchObject({ name: 'Demo-Praxis', advisory: true });
    expect(allPassed(results)).toBe(true);
  });

  it('fails the smoke test, which needs the data', async () => {
    const results = await runChecks(
      smokeChecks(STACKS.prod, WITH_MAILPIT, RUN_ID),
      answering(routes),
    );
    expect(allPassed(results)).toBe(false);
  });
});

describe('the checks of a healthy stack', () => {
  it.each(['dev', 'prod'] as const)('%s passes the smoke test', async (mode) => {
    const results = await runChecks(
      smokeChecks(STACKS[mode], WITH_MAILPIT, RUN_ID),
      answering(healthyRoutes(mode)),
    );
    expect(results.filter(({ ok }) => !ok)).toEqual([]);
  });

  it('sends no test sign-up through a real mail server, which would send real e-mails', async () => {
    const checks = smokeChecks(STACKS.dev, { swaggerEnabled: false, catchesMail: false }, RUN_ID);
    expect(checks.filter(({ method }) => method === 'POST')).toEqual([]);
    expect(checks.map(({ url }) => url).join(' ')).not.toContain('/api/v1/search');
    const results = await runChecks(checks, answering(healthyRoutes('dev')));
    expect(results.filter(({ ok }) => !ok)).toEqual([]);
  });

  it('asks the probes past the proxy in production', () => {
    const urls = healthChecks(STACKS.prod).map(({ url }) => url);
    expect(urls).toContain('http://localhost:8081/health/ready');
    expect(urls).toContain('http://localhost:8082/healthz');
    expect(urls).toContain('http://localhost:8080/en');
  });

  it('expects the Swagger UI only where it is on', () => {
    const names = (enabled: boolean) =>
      smokeChecks(STACKS.prod, { ...WITH_MAILPIT, swaggerEnabled: enabled }).map(
        ({ name }) => name,
      );
    expect(names(false)).toContain('Swagger ist aus');
    expect(names(true)).not.toContain('Swagger ist aus');
  });
});

describe('what the smoke test catches', () => {
  async function failuresWith(mode: 'dev' | 'prod', overrides: Routes): Promise<readonly string[]> {
    const routes = { ...healthyRoutes(mode), ...overrides };
    const results = await runChecks(
      smokeChecks(STACKS[mode], WITH_MAILPIT, RUN_ID),
      answering(routes),
      0,
    );
    return results.filter(({ ok }) => !ok).map(({ problem }) => problem);
  }

  it('a sign-up whose e-mail never arrives', async () => {
    expect(
      await failuresWith('dev', {
        [mailSearchUrl(STACKS.dev.mailUrl, 'ar')]: { status: 200, body: '{"messages":[]}' },
      }),
    ).toEqual(['Keine E-Mail im Mailpit']);
  });

  it('a sign-up the API does not take', async () => {
    expect(
      await failuresWith('prod', {
        [`${STACKS.prod.apiUrl}/api/v1/auth/register`]: { status: 500 },
      }),
    ).toEqual(['Status 500 statt 202', 'Status 500 statt 202']);
  });

  it('a proxy that lets a forged address open its own limit', async () => {
    expect(
      await failuresWith('prod', {
        'http://localhost:8080/api/v1/public/practices/al-noor': {
          ...DEMO_PRACTICE_ANSWER,
          headers: { 'x-ratelimit-remaining': '59' },
        },
      }),
    ).toEqual(['Gefälschte Adresse öffnet ein eigenes Limit']);
  });

  it('an API that says nothing about its limit', async () => {
    expect(
      await failuresWith('prod', {
        'http://localhost:8080/api/v1/public/practices/al-noor': DEMO_PRACTICE_ANSWER,
      }),
    ).toEqual(['Keine Angabe zum Limit', 'Keine Angabe zum Limit']);
  });

  it('a limit that is used up says so, instead of blaming the proxy', async () => {
    const problems = await failuresWith('prod', {
      'http://localhost:8080/api/v1/public/practices/al-noor': { status: 429 },
    });
    expect(new Set(problems)).toEqual(new Set(['Status 429 statt 200']));
  });

  it('a proxy that keeps the request id of the visitor', async () => {
    expect(
      await failuresWith('prod', {
        'http://localhost:8080/api/v1/public/practices/gibt-es-nicht': {
          status: 404,
          headers: {
            'content-type': 'application/problem+json',
            'x-request-id': '11111111-1111-4111-8111-111111111111',
          },
        },
      }),
    ).toEqual(['Request-ID des Besuchers übernommen']);
  });

  it('an answer without a request id', async () => {
    expect(
      await failuresWith('prod', {
        'http://localhost:8080/api/v1/public/practices/gibt-es-nicht': {
          status: 404,
          headers: { 'content-type': 'application/problem+json' },
        },
      }),
    ).toEqual(['Keine Request-ID']);
  });

  it('a practice page that fails, or lacks its heading or search data', async () => {
    const url = 'http://localhost:8080/en/al-noor';
    expect(await failuresWith('prod', { [url]: { status: 500 } })).toEqual([
      'Status 500 statt 200',
    ]);
    expect(await failuresWith('prod', { [url]: { status: 200, body: '<p>x</p>' } })).toEqual([
      'Keine Überschrift',
    ]);
    expect(await failuresWith('prod', { [url]: { status: 200, body: '<h1>x</h1>' } })).toEqual([
      'Keine Suchdaten',
    ]);
  });

  it('a practice without free times, or an API that cannot say', async () => {
    const url = freeTimesUrl('http://localhost:3001');
    expect(
      await failuresWith('dev', {
        [url]: { status: 200, body: '{"days":[{"hasFreeTimes":false}]}' },
      }),
    ).toEqual(['Kein Tag mit freien Terminen']);
    expect(await failuresWith('dev', { [url]: { status: 503 } })).toEqual(['Status 503 statt 200']);
  });

  it('a sitemap that fails, or names the address of the container', async () => {
    const url = 'http://localhost:8080/sitemap.xml';
    expect(await failuresWith('prod', { [url]: { status: 500 } })).toEqual([
      'Status 500 statt 200',
    ]);
    expect(
      await failuresWith('prod', {
        [url]: { status: 200, body: '<loc>http://web:3000/en/al-noor</loc>' },
      }),
    ).toEqual(['http://localhost:8080/en/al-noor fehlt']);
  });

  it('a redirect to the address of the container', async () => {
    expect(
      await failuresWith('prod', {
        'http://localhost:8080/': { status: 307, headers: { location: 'http://0.0.0.0:3000/en' } },
      }),
    ).toEqual(['Ziel http://0.0.0.0:3000/en']);
  });

  it('a start page that does not redirect', async () => {
    expect(await failuresWith('dev', { 'http://localhost:3000/': { status: 200 } })).toEqual([
      'Status 200 statt 307',
    ]);
  });

  it('accepts a redirect to the full address of the site', async () => {
    expect(
      await failuresWith('prod', {
        'http://localhost:8080/': {
          status: 307,
          headers: { location: 'http://localhost:8080/en' },
        },
      }),
    ).toEqual([]);
  });

  it('a redirect without a target', async () => {
    expect(await failuresWith('dev', { 'http://localhost:3000/': { status: 307 } })).toEqual([
      'Ziel ',
    ]);
  });

  it('a proxy that lets probes through', async () => {
    expect(
      await failuresWith('prod', { 'http://localhost:8080/healthz': { status: 200 } }),
    ).toEqual(['Status 200 statt 404']);
  });

  it('a Swagger UI that should be off', async () => {
    expect(
      await failuresWith('prod', { 'http://localhost:8080/api/docs': { status: 200 } }),
    ).toEqual(['Status 200 statt 404']);
  });

  it('a page in the wrong direction', async () => {
    expect(
      await failuresWith('dev', {
        'http://localhost:3000/ar': { status: 200, body: '<html dir="ltr">' },
      }),
    ).toEqual(['Nicht dir="rtl"']);
  });

  it('a page without a nonce', async () => {
    expect(
      await failuresWith('dev', {
        'http://localhost:3000/ar': {
          status: 200,
          body: '<html dir="rtl">',
          headers: { 'content-security-policy': "script-src 'self'" },
        },
      }),
    ).toEqual(['Keine CSP mit Nonce']);
  });

  it('a page that does not load', async () => {
    expect(await failuresWith('dev', { 'http://localhost:3000/ar': { status: 500 } })).toEqual([
      'Status 500 statt 200',
    ]);
  });

  it('an error that is no problem document', async () => {
    expect(
      await failuresWith('dev', {
        'http://localhost:3001/api/v1/public/practices/gibt-es-nicht': {
          status: 404,
          headers: { 'content-type': 'text/html' },
        },
      }),
    ).toEqual(['Content-Type text/html']);
  });

  it('a missing problem status', async () => {
    expect(
      await failuresWith('dev', {
        'http://localhost:3001/api/v1/public/practices/gibt-es-nicht': { status: 500 },
      }),
    ).toEqual(['Status 500 statt 404']);
  });

  it('a practice that is missing, with what to do', async () => {
    const results = await runChecks(
      smokeChecks(STACKS.dev, WITH_MAILPIT, RUN_ID),
      answering({
        ...healthyRoutes('dev'),
        'http://localhost:3001/api/v1/public/practices/al-noor': { status: 404 },
      }),
    );
    expect(results.find(({ ok }) => !ok)).toMatchObject({
      name: 'Demo-Praxis',
      problem: 'Status 404 statt 200',
      hint: expect.stringContaining('Demo-Praxen einspielen') as unknown,
    });
  });

  it('the wrong practice', async () => {
    expect(
      await failuresWith('dev', {
        'http://localhost:3001/api/v1/public/practices/al-noor': {
          status: 200,
          body: '{"slug":"other"}',
        },
      }),
    ).toEqual(['Falsche Praxis']);
  });

  it('a service that is not healthy', async () => {
    expect(
      await failuresWith('dev', { 'http://localhost:3001/health/ready': { status: 503 } }),
    ).toEqual(['Status 503']);
  });
});

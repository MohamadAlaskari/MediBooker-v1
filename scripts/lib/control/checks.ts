import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { PRIVACY_NOTICE_VERSION } from '../../../packages/i18n/src/legal.ts';
import { DEMO_PRACTICE, DEMO_SERVICE, type Stack } from './stacks.ts';

// A development server compiles a page on its first request.
const TIMEOUT_MS = 30_000;
const RETRY_PAUSE_MS = 1000;

interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

/** One HTTP request and what it must answer. `verify` returns the problem, or undefined. */
export interface Check {
  readonly name: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** GET unless a check says otherwise. */
  readonly method?: 'POST';
  readonly body?: string;
  /** How often to ask, a second apart, for something that happens in the background. */
  readonly attempts?: number;
  readonly verify: (answer: Answer) => string | undefined;
  /** What to do when it fails, if there is more to say than the problem. */
  readonly hint?: string;
  /** A failure is a valid state, not an error: an empty database, for example. */
  readonly advisory?: boolean;
}

export interface CheckResult {
  readonly name: string;
  readonly url: string;
  readonly ok: boolean;
  /** Empty when it passed. */
  readonly problem: string;
  readonly hint: string | undefined;
  readonly advisory: boolean;
}

function hasStatus(expected: number) {
  return ({ status }: Answer): string | undefined =>
    status === expected ? undefined : `Status ${String(status)} statt ${String(expected)}`;
}

function isHealthy({ status }: Answer): string | undefined {
  return status >= 200 && status < 300 ? undefined : `Status ${String(status)}`;
}

const SEED_HINT = 'Menüpunkt "Demo-Praxen einspielen"';
const CHOSEN_REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function demoPracticeCheck(stack: Stack): Check {
  return {
    name: 'Demo-Praxis',
    url: `${stack.apiUrl}/api/v1/public/practices/${DEMO_PRACTICE}`,
    hint: SEED_HINT,
    verify: (answer) => {
      const problem = hasStatus(200)(answer);
      if (problem !== undefined) return problem;
      return answer.text.includes(`"slug":"${DEMO_PRACTICE}"`) ? undefined : 'Falsche Praxis';
    },
  };
}

/** Are the services up? */
function probeChecks(stack: Stack): readonly Check[] {
  return [
    {
      name: 'API lebt',
      url: `${stack.apiProbeUrl}/health/live`,
      verify: isHealthy,
    },
    {
      name: 'API bereit (Datenbank)',
      url: `${stack.apiProbeUrl}/health/ready`,
      verify: isHealthy,
    },
    {
      name: 'Web lebt',
      url: `${stack.webProbeUrl}/healthz`,
      verify: isHealthy,
    },
    {
      name: 'Web-Seite',
      url: `${stack.webUrl}/en`,
      verify: isHealthy,
    },
    {
      name: 'E-Mail-Fänger (Mailpit)',
      url: `${stack.mailUrl}/livez`,
      verify: isHealthy,
    },
  ];
}

/** The menu's health entry: a fresh database without demo practices is no error. */
export function healthChecks(stack: Stack): readonly Check[] {
  return [...probeChecks(stack), { ...demoPracticeCheck(stack), advisory: true }];
}

function pageCheck(stack: Stack, locale: string, direction: string): Check {
  return {
    name: `Seite /${locale}: ${direction}, CSP mit Nonce`,
    url: `${stack.webUrl}/${locale}`,
    verify: (answer) => {
      const problem = hasStatus(200)(answer);
      if (problem !== undefined) return problem;
      if (!answer.text.includes(`dir="${direction}"`)) return `Nicht dir="${direction}"`;
      const policy = answer.headers.get('content-security-policy') ?? '';
      return policy.includes("'nonce-") ? undefined : 'Keine CSP mit Nonce';
    },
  };
}

/** The web app reads the API: the whole way from the page to a practice's own database. */
function practicePageCheck(stack: Stack): Check {
  return {
    name: 'Praxisseite zeigt die Praxis und ihre Suchdaten',
    url: `${stack.webUrl}/en/${DEMO_PRACTICE}`,
    hint: SEED_HINT,
    verify: (answer) => {
      const problem = hasStatus(200)(answer);
      if (problem !== undefined) return problem;
      if (!answer.text.includes('<h1')) return 'Keine Überschrift';
      return answer.text.includes('application/ld+json') ? undefined : 'Keine Suchdaten';
    },
  };
}

/** The rules of the seed became slots: the whole way from the job to the public free times. */
function freeTimesCheck(stack: Stack): Check {
  return {
    name: 'Demo-Praxis hat freie Termine',
    url: `${stack.apiUrl}/api/v1/public/practices/${DEMO_PRACTICE}/availability?serviceId=${DEMO_SERVICE}`,
    hint: SEED_HINT,
    verify: (answer) => {
      const problem = hasStatus(200)(answer);
      if (problem !== undefined) return problem;
      return answer.text.includes('"hasFreeTimes":true')
        ? undefined
        : 'Kein Tag mit freien Terminen';
    },
  };
}

/** From the registry, with the address of the site: an image knows it only at run time (RT-30). */
function sitemapCheck(stack: Stack): Check {
  const address = `${stack.webUrl}/en/${DEMO_PRACTICE}`;
  return {
    name: 'Sitemap nennt die Praxis unter der Adresse der Seite',
    url: `${stack.webUrl}/sitemap.xml`,
    hint: SEED_HINT,
    verify: (answer) => {
      const problem = hasStatus(200)(answer);
      if (problem !== undefined) return problem;
      return answer.text.includes(`<loc>${address}</loc>`) ? undefined : `${address} fehlt`;
    },
  };
}

/** The whole way of an account e-mail: the sign-up, its outbox and the mail server. */
function accountEmailChecks(stack: Stack, runId: string, locale: string): readonly Check[] {
  const email = `smoke-${runId}-${locale}@example.test`;
  return [
    {
      name: `Registrierung nimmt an (${locale})`,
      url: `${stack.apiUrl}/api/v1/auth/register`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: randomUUID(),
        locale,
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      }),
      verify: hasStatus(202),
    },
    {
      name: `Bestätigungs-E-Mail kommt an (${locale})`,
      url: `${stack.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
      attempts: 20,
      hint: 'Der Ausgang der API schickt alle paar Sekunden: Protokoll der API ansehen',
      verify: (answer) => {
        const problem = hasStatus(200)(answer);
        if (problem !== undefined) return problem;
        return answer.text.includes(email) ? undefined : 'Keine E-Mail im Mailpit';
      },
    },
  ];
}

/** Behind a proxy a redirect easily names the container's own address instead of the site. */
function rootRedirectCheck(stack: Stack): Check {
  return {
    name: 'Startseite leitet zur Sprache des Besuchers',
    url: `${stack.webUrl}/`,
    headers: { 'Accept-Language': 'en' },
    verify: (answer) => {
      const problem = hasStatus(307)(answer);
      if (problem !== undefined) return problem;
      const target = answer.headers.get('location') ?? '';
      return target === '/en' || target === `${stack.webUrl}/en` ? undefined : `Ziel ${target}`;
    },
  };
}

function problemCheck(stack: Stack): Check {
  return {
    name: 'Unbekannte Praxis: 404 als problem+json',
    url: `${stack.apiUrl}/api/v1/public/practices/gibt-es-nicht`,
    verify: (answer) => {
      const problem = hasStatus(404)(answer);
      if (problem !== undefined) return problem;
      const type = answer.headers.get('content-type') ?? '';
      return type.includes('application/problem+json') ? undefined : `Content-Type ${type}`;
    },
  };
}

/**
 * Two requests with two forged addresses (RT-03). The proxy replaces them, so both count against
 * the one real visitor and the second has less left; otherwise each would open its own limit.
 */
function forgedAddressChecks(stack: Stack): readonly Check[] {
  const url = `${stack.apiUrl}/api/v1/public/practices/${DEMO_PRACTICE}`;
  const remainingOf = ({ headers }: Answer): number | undefined => {
    const remaining = headers.get('x-ratelimit-remaining');
    return remaining === null ? undefined : Number(remaining);
  };
  let first: number | undefined;
  return [
    {
      name: 'Rate-Limit antwortet auch bei gefälschter Adresse',
      url,
      headers: { 'X-Forwarded-For': '203.0.113.1' },
      hint: SEED_HINT,
      verify: (answer) => {
        const problem = hasStatus(200)(answer);
        if (problem !== undefined) return problem;
        first = remainingOf(answer);
        return first === undefined ? 'Keine Angabe zum Limit' : undefined;
      },
    },
    {
      name: 'Proxy ersetzt eine vom Besucher gefälschte Adresse',
      url,
      headers: { 'X-Forwarded-For': '203.0.113.2' },
      hint: SEED_HINT,
      verify: (answer) => {
        const problem = hasStatus(200)(answer);
        if (problem !== undefined) return problem;
        const second = remainingOf(answer);
        if (first === undefined || second === undefined) return 'Keine Angabe zum Limit';
        return second < first ? undefined : 'Gefälschte Adresse öffnet ein eigenes Limit';
      },
    },
  ];
}

/** The production stack keeps probes and the Swagger UI away from visitors. */
function behindProxyChecks(stack: Stack, swaggerEnabled: boolean): readonly Check[] {
  return [
    ...forgedAddressChecks(stack),
    {
      name: 'Proxy leitet /health/ready nicht weiter',
      url: `${stack.webUrl}/health/ready`,
      verify: hasStatus(404),
    },
    {
      name: 'Proxy leitet /healthz nicht weiter',
      url: `${stack.webUrl}/healthz`,
      verify: hasStatus(404),
    },
    {
      name: 'Proxy ersetzt eine vom Besucher gewählte Request-ID',
      url: `${stack.apiUrl}/api/v1/public/practices/gibt-es-nicht`,
      headers: { 'X-Request-Id': CHOSEN_REQUEST_ID },
      verify: ({ headers }) => {
        const id = headers.get('x-request-id');
        if (id === null) return 'Keine Request-ID';
        return id === CHOSEN_REQUEST_ID ? 'Request-ID des Besuchers übernommen' : undefined;
      },
    },
    ...(swaggerEnabled
      ? []
      : [
          {
            name: 'Swagger ist aus',
            url: `${stack.apiUrl}/api/docs`,
            verify: hasStatus(404),
          },
        ]),
  ];
}

export interface SmokeOptions {
  readonly swaggerEnabled: boolean;
  /** Mailpit takes the e-mails. With a real mail server a test sign-up would send a real one. */
  readonly catchesMail: boolean;
}

/** The smoke test: what a visitor and a client depend on, against the running containers. */
export function smokeChecks(
  stack: Stack,
  { swaggerEnabled, catchesMail }: SmokeOptions,
  runId = String(Date.now()),
): readonly Check[] {
  return [
    ...probeChecks(stack),
    demoPracticeCheck(stack),
    freeTimesCheck(stack),
    rootRedirectCheck(stack),
    pageCheck(stack, 'ar', 'rtl'),
    practicePageCheck(stack),
    sitemapCheck(stack),
    pageCheck(stack, 'en', 'ltr'),
    problemCheck(stack),
    ...(catchesMail
      ? [...accountEmailChecks(stack, runId, 'ar'), ...accountEmailChecks(stack, runId, 'en')]
      : []),
    ...(stack.mode === 'dev'
      ? [
          {
            name: 'Swagger',
            url: `${stack.apiProbeUrl}/api/docs`,
            verify: hasStatus(200),
          },
        ]
      : behindProxyChecks(stack, swaggerEnabled)),
  ];
}

/** The problem of one request, or undefined. An unreachable service is a problem. */
async function askOnce(check: Check, fetchImpl: typeof fetch): Promise<string | undefined> {
  const { url, headers, method, body, verify } = check;
  try {
    const response = await fetchImpl(url, {
      ...(headers === undefined ? {} : { headers }),
      ...(method === undefined ? {} : { method }),
      ...(body === undefined ? {} : { body }),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return verify({
      status: response.status,
      headers: response.headers,
      text: await response.text(),
    });
  } catch {
    return 'Nicht erreichbar';
  }
}

/** Runs the checks one after the other. Never throws: an unreachable service is a failed check. */
export async function runChecks(
  checks: readonly Check[],
  fetchImpl: typeof fetch = fetch,
  retryPauseMs: number = RETRY_PAUSE_MS,
): Promise<readonly CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    const { name, url, hint, advisory, attempts = 1 } = check;
    let problem = await askOnce(check, fetchImpl);
    for (let asked = 1; problem !== undefined && asked < attempts; asked += 1) {
      await pause(retryPauseMs);
      problem = await askOnce(check, fetchImpl);
    }
    results.push({
      name,
      url,
      ok: problem === undefined,
      problem: problem ?? '',
      hint,
      advisory: advisory === true,
    });
  }
  return results;
}

/** Whether nothing failed; an advisory result does not count. */
export function allPassed(results: readonly CheckResult[]): boolean {
  return results.every(({ ok, advisory }) => ok || advisory);
}

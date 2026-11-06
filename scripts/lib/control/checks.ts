import { DEMO_PRACTICE, type Stack } from './stacks.ts';

const TIMEOUT_MS = 5000;

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

/** The production stack keeps probes and the Swagger UI away from visitors. */
function behindProxyChecks(stack: Stack, swaggerEnabled: boolean): readonly Check[] {
  return [
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

/** The smoke test: what a visitor and a client depend on, against the running containers. */
export function smokeChecks(stack: Stack, swaggerEnabled: boolean): readonly Check[] {
  return [
    ...probeChecks(stack),
    demoPracticeCheck(stack),
    rootRedirectCheck(stack),
    pageCheck(stack, 'ar', 'rtl'),
    pageCheck(stack, 'en', 'ltr'),
    problemCheck(stack),
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

/** Runs the checks one after the other. Never throws: an unreachable service is a failed check. */
export async function runChecks(
  checks: readonly Check[],
  fetchImpl: typeof fetch = fetch,
): Promise<readonly CheckResult[]> {
  const results: CheckResult[] = [];
  for (const { name, url, headers, verify, hint, advisory } of checks) {
    let problem: string | undefined;
    try {
      const response = await fetchImpl(url, {
        ...(headers === undefined ? {} : { headers }),
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      problem = verify({
        status: response.status,
        headers: response.headers,
        text: await response.text(),
      });
    } catch {
      problem = 'Nicht erreichbar';
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

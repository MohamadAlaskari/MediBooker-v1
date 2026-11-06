/**
 * API test apps for the tenancy specs (02 §12): createTestApp with the test-only practice probe
 * route of test/support, and what the specs read from them. Answers carry statuses, ids and
 * reason codes only, never a client or a connection detail, so a failed assertion prints none.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { PracticeResolver } from '../../../src/common/tenancy/practice-resolver.js';
import type { PracticePurpose, PracticeRoute } from '../../../src/common/tenancy/practice-route.js';
import { createTestApp, type TestAppOptions } from '../../support/create-test-app.js';
import type { LogCapture } from '../../support/log-capture.js';
import { PracticeProbeModule } from '../../support/practice-probe.module.js';

/** createTestApp with PracticeProbeModule and the spec's own test-only modules. */
export function createProbeApp(options: TestAppOptions): Promise<NestExpressApplication> {
  return createTestApp({ ...options, imports: [PracticeProbeModule, ...(options.imports ?? [])] });
}

/**
 * One app for a describe block: created in its beforeAll, after the hooks registered before it
 * (the file's databases), and closed in its afterAll only when it was created, so a failed setup
 * reports its own error alone. Tests read the app through the returned function.
 */
export function useSharedApp(
  create: () => Promise<NestExpressApplication>,
): () => NestExpressApplication {
  let app: NestExpressApplication | undefined;
  beforeAll(async () => {
    app = await create();
  });
  afterAll(async () => {
    await app?.close();
  });
  return () => {
    if (app === undefined) throw new Error('the shared app was not created');
    return app;
  };
}

/**
 * Registers an afterEach that closes every app a test started, and returns the starter: probe
 * apps whose environment is `baseEnv()` (read when the test runs, for example the file's
 * `databases.apiEnv`) with the test's own variables over it. No cached client crosses tests.
 */
export function useProbeApps(
  baseEnv: () => Readonly<Record<string, string>>,
): (options?: TestAppOptions) => Promise<NestExpressApplication> {
  const apps: NestExpressApplication[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });
  return async (options = {}) => {
    const app = await createProbeApp({ ...options, env: { ...baseEnv(), ...options.env } });
    apps.push(app);
    return app;
  };
}

/** How the probe route answered for one practice. */
export interface IdentityAnswer {
  readonly status: number;
  /** The id that the practice database's `practice_identity` names, from a 200 answer. */
  readonly practiceId: string | undefined;
  readonly retryAfter: string | undefined;
  /** The raw body: a refusal must carry no practice data. */
  readonly body: string;
}

function practiceIdOf(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null || !('practiceId' in parsed)) {
      return undefined;
    }
    return typeof parsed.practiceId === 'string' ? parsed.practiceId : undefined;
  } catch {
    return undefined;
  }
}

/** GET /api/v1/practices/:practiceId/probe/identity, the @PracticeScoped('id') probe route. */
export async function requestIdentity(
  app: NestExpressApplication,
  practiceId: string,
): Promise<IdentityAnswer> {
  const response = await request(app.getHttpServer()).get(
    `/api/v1/practices/${practiceId}/probe/identity`,
  );
  const retryAfter: unknown = response.headers['retry-after'];
  return {
    status: response.status,
    practiceId: response.status === 200 ? practiceIdOf(response.text) : undefined,
    retryAfter: typeof retryAfter === 'string' ? retryAfter : undefined,
    // An error is compared by its code: the rest of its body is the catalogue's and the request id.
    body:
      response.status === 200
        ? response.text
        : (JSON.parse(response.text) as { code: string }).code,
  };
}

/** A 200 answer for the practice. */
export function served(practiceId: string): IdentityAnswer {
  return {
    status: 200,
    practiceId,
    retryAfter: undefined,
    body: JSON.stringify({ practiceId }),
  };
}

/** A 503 answer with `Retry-After: 30`; the problem body names no practice (05 §1.3). */
export const UNAVAILABLE: IdentityAnswer = {
  status: 503,
  practiceId: undefined,
  retryAfter: '30',
  body: 'SERVICE_UNAVAILABLE',
};

/** A 404 answer: the practice is hidden. */
export const NOT_FOUND: IdentityAnswer = {
  status: 404,
  practiceId: undefined,
  retryAfter: undefined,
  body: 'NOT_FOUND',
};

/** The route the app's resolver serves a practice with, for direct connection-manager calls. */
export async function servedRoute(
  app: NestExpressApplication,
  practiceId: string,
  purpose: PracticePurpose,
): Promise<PracticeRoute> {
  const resolution = await app.get(PracticeResolver).resolve(practiceId, purpose);
  if (resolution.answer !== 'SERVE') {
    throw new Error(`the practice is not served: ${resolution.answer}`);
  }
  return resolution.route;
}

/** The reason codes logged for a practice (`{ practiceId, reasonCode }`, 02 §5), in order. */
export function reasonCodesOf(logs: LogCapture, practiceId: string): unknown[] {
  return logs
    .lines()
    .filter((line) => line.practiceId === practiceId && line.reasonCode !== undefined)
    .map((line) => line.reasonCode);
}

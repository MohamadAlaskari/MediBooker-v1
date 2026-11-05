/**
 * Data-layer failures keep the synthetic markers of 02 §8 out of every log: a forced
 * PrismaClientValidationError, a CHECK violation and a unique violation on the platform client
 * carry `secret-value` or `sara@example.test` in their input, and neither the captured logs nor
 * the test cluster's server log (the production log settings plus log_statement=all, ADR 0005
 * §4.10) keep it; a refused practice connection logs no password, host or connection string.
 * The CLI runs (provisioning, migrations) are checked by the harness's specs.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { getTransactionHostToken } from '@nestjs-cls/transactional';
import request from 'supertest';
import { describe, expect, inject, it } from 'vitest';
import type { PlatformTransactionHost } from '../../src/common/database/platform-transactional.js';
import { SecretStore } from '../../src/common/database/secret-store.js';
import { createTestApp } from '../support/create-test-app.js';
import { captureLogs } from '../support/log-capture.js';
import { usePracticeDatabases } from '../support/practices.js';
import { SYNTHETIC_EMAIL, SYNTHETIC_SECRET_VALUE } from '../support/probe.module.js';
import {
  FORCED_PLATFORM_ERRORS,
  PlatformErrorProbeModule,
} from './probes/platform-error-probe.module.js';
import {
  reasonCodesOf,
  requestIdentity,
  UNAVAILABLE,
  useProbeApps,
  useSharedApp,
} from './probes/probe-app.js';
import { serverLogThroughNow } from './probes/server-log-barrier.js';
import { forbiddenIn, generatedSecrets } from './support/secrets.js';
import { readServerLog } from './support/server-log.js';

/** The markers a text contains; a failed assertion prints these, never the text. */
function markersIn(text: string): string[] {
  return [SYNTHETIC_SECRET_VALUE, SYNTHETIC_EMAIL].filter((marker) => text.includes(marker));
}

/** A port that refuses every connection, as TEST_ENV's platform URL uses (06 §3). */
const REFUSING_ENDPOINT = '127.0.0.1:9';

/** A secret store whose every secret is the same wrong password: the database refuses it. */
class WrongPasswordStore extends SecretStore {
  constructor(private readonly password: string) {
    super();
  }

  get(): Promise<string> {
    return Promise.resolve(this.password);
  }
}

describe('logging of data-layer failures (02 §8)', () => {
  const databases = usePracticeDatabases();
  const cluster = inject('integrationCluster');

  describe('forced Prisma errors on the platform client', () => {
    const logs = captureLogs();
    const app = useSharedApp(() =>
      createTestApp({
        env: databases.apiEnv,
        imports: [PlatformErrorProbeModule],
        logDestination: logs,
      }),
    );

    /** Requests a forced error and returns its answer and the errors logged for it. */
    async function forceError(path: string): Promise<{ status: number; errors: unknown[] }> {
      const requestId = randomUUID();
      const response = await request(app().getHttpServer())
        .get(`/api/v1/probe/platform-errors/${path}`)
        .set('X-Request-Id', requestId);
      await logs.waitForAccessLine(requestId);
      expect(markersIn(response.text)).toEqual([]);
      const errors = logs
        .lines()
        .filter((line) => line.reqId === requestId && line.msg === 'unknown exception')
        .map((line) => line.err);
      return { status: response.status, errors };
    }

    it('02 §8 the validation error carries its markers in its message and the CHECK violation in its driver report (the control)', async () => {
      const platform = app().get<PlatformTransactionHost>(getTransactionHostToken('platform'), {
        strict: false,
      });
      // The driver adapter keeps only the index of a unique violation; its detail, which names
      // the value, stays in the database's error, and the server log check below covers it.
      const errors = await Promise.all(
        [FORCED_PLATFORM_ERRORS.validation, FORCED_PLATFORM_ERRORS['check-violation']].map(
          (force) =>
            force(platform).then(
              () => undefined,
              (error: unknown) => error,
            ),
        ),
      );
      expect(errors.map((error) => markersIn(inspect(error, { depth: null })))).toEqual([
        [SYNTHETIC_SECRET_VALUE, SYNTHETIC_EMAIL],
        [SYNTHETIC_EMAIL],
      ]);
    });

    it.each([
      ['a PrismaClientValidationError', 'validation', { type: 'PrismaClientValidationError' }],
      [
        'a CHECK violation',
        'check-violation',
        {
          type: 'PrismaClientKnownRequestError',
          code: '23514',
          prismaCode: expect.stringMatching(/^P\d{4}$/) as unknown,
          model: 'PracticeSlug',
        },
      ],
      [
        'a unique violation',
        'unique-violation',
        {
          type: 'PrismaClientKnownRequestError',
          code: '23505',
          prismaCode: 'P2002',
          model: 'PracticeSlug',
          constraint: 'practice_slugs_pkey',
        },
      ],
    ])(
      '02 §8 %s is logged with its codes and without the marker it carries',
      async (_, path, codes) => {
        expect(await forceError(path)).toEqual({
          status: 500,
          errors: [expect.objectContaining(codes) as unknown],
        });
        expect(markersIn(logs.text())).toEqual([]);
      },
    );

    it('ADR-0005 §4.10 the server log holds the failed statements without the failing values', async () => {
      for (const path of Object.keys(FORCED_PLATFORM_ERRORS)) {
        expect((await forceError(path)).status).toBe(500);
      }
      const log = await serverLogThroughNow(readServerLog, databases.superuserUrl());
      expect({
        statements: log.includes('INSERT INTO "public"."practice_slugs"'),
        checkViolation: log.includes('violates check constraint "practice_slugs_slug_check"'),
        uniqueViolation: log.includes('violates unique constraint "practice_slugs_pkey"'),
        markers: markersIn(log),
      }).toEqual({ statements: true, checkViolation: true, uniqueViolation: true, markers: [] });
    });
  });

  describe('a refused practice connection', () => {
    const startApp = useProbeApps(() => databases.apiEnv);

    function practiceSecrets(): Readonly<Record<string, string>> {
      return generatedSecrets(cluster.secrets, [
        databases.practiceA.practiceId,
        databases.practiceB.practiceId,
      ]);
    }

    it('02 §8 a refused port leaves no password, host or connection string in the captured logs', async () => {
      const logs = captureLogs();
      const app = await startApp({
        env: { DATABASE_CLUSTER_ENDPOINTS: JSON.stringify({ local: REFUSING_ENDPOINT }) },
        logDestination: logs,
      });
      const { practiceId } = databases.practiceA;
      expect(await requestIdentity(app, practiceId)).toEqual(UNAVAILABLE);
      expect(reasonCodesOf(logs, practiceId)).toEqual(['PRACTICE_CONNECTION_FAILED']);
      expect([
        ...forbiddenIn(logs.text(), '127.0.0.1', practiceSecrets()),
        ...forbiddenIn(logs.text(), cluster.host, {}),
      ]).toEqual([]);
    });

    it('02 §8 a refused password leaves no password, host or connection string in the captured logs', async () => {
      const logs = captureLogs();
      // Generated, never printed: a failed assertion names the secret, not its value.
      const refusedPassword = randomBytes(32).toString('base64url');
      const app = await startApp({
        logDestination: logs,
        overrides: [{ provide: SecretStore, useValue: new WrongPasswordStore(refusedPassword) }],
      });
      const { practiceId } = databases.practiceB;
      expect(await requestIdentity(app, practiceId)).toEqual(UNAVAILABLE);
      expect(reasonCodesOf(logs, practiceId)).toEqual(['PRACTICE_AUTHENTICATION_FAILED']);
      expect(
        forbiddenIn(logs.text(), cluster.host, {
          ...practiceSecrets(),
          'refused password': refusedPassword,
        }),
      ).toEqual([]);
    });
  });
});

/**
 * The lifecycle status table of ADR 0005 §5.1 on the entry points of F04 (§11.4): the
 * @PracticeScoped('id') probe route, which serves signed-in requests, and runInPractice for every
 * purpose, each time after the app cached the practice's client while it was ACTIVE; a cached
 * client after CONNECT is revoked from the app role; and the schema guard (§6.8). The registry is
 * changed as platform_owner, as medibooker-db changes it.
 */
import { getTransactionHostToken } from '@nestjs-cls/transactional';
import { afterEach, describe, expect, it } from 'vitest';
import { PracticeConnectionManager } from '../../../src/common/tenancy/practice-connection-manager.js';
import { PracticeUnavailableError } from '../../../src/common/tenancy/practice-errors.js';
import type { PracticePurpose } from '../../../src/common/tenancy/practice-route.js';
import { PracticeRunner } from '../../../src/common/tenancy/practice-runner.js';
import type { PracticeTransactionHost } from '../../../src/common/tenancy/practice-transactional.adapter.js';
import type { PracticeStatus } from '../../../src/generated/platform/enums.js';
import { PRACTICE_SCHEMA_REQUIRED } from '../../../src/generated/schema-versions.js';
import { captureLogs } from '../../support/log-capture.js';
import { usePracticeDatabases } from '../../support/practices.js';
import {
  createProbeApp,
  type IdentityAnswer,
  NOT_FOUND,
  reasonCodesOf,
  requestIdentity,
  served,
  UNAVAILABLE,
  useSharedApp,
} from '../probes/probe-app.js';
import { changeRegistry } from '../probes/registry.js';
import { quoteIdent, withClient } from '../support/sql.js';

type StatusAnswer = 'SERVE' | 'NOT_FOUND' | 'UNAVAILABLE';

/**
 * ADR 0005 §5.1 for the entry points of F04. Signed-in requests, public requests and jobs answer
 * alike before A01: under restore review only the practice's admins are served, and there are no
 * admins yet; "no" and "paused" jobs are refused like 404 and 503.
 */
const STATUS_TABLE: readonly (readonly [PracticeStatus, StatusAnswer])[] = [
  ['PROVISIONING', 'NOT_FOUND'],
  ['ACTIVE', 'SERVE'],
  ['SUSPENDED', 'UNAVAILABLE'],
  ['MOVING', 'UNAVAILABLE'],
  ['RESTORE_REVIEW', 'UNAVAILABLE'],
  ['DEPROVISIONING', 'NOT_FOUND'],
  ['FINALIZED', 'NOT_FOUND'],
];

const PURPOSES: readonly PracticePurpose[] = ['request', 'public', 'job'];

/** A schema version older than every build's: migration names start with their timestamp. */
const OLDER_SCHEMA_VERSION = '20260101000000_older_schema';

/** How runInPractice answered: the identity it read, or why it refused. */
type RunAnswer = { readonly served: string } | { readonly refused: string };

function httpAnswer(answer: StatusAnswer, practiceId: string): IdentityAnswer {
  if (answer === 'SERVE') return served(practiceId);
  return answer === 'NOT_FOUND' ? NOT_FOUND : UNAVAILABLE;
}

function runAnswer(answer: StatusAnswer, practiceId: string): RunAnswer {
  if (answer === 'SERVE') return { served: practiceId };
  return { refused: answer === 'NOT_FOUND' ? 'PRACTICE_NOT_FOUND' : 'PRACTICE_STATUS_UNAVAILABLE' };
}

describe('the practice status table (ADR 0005 §5.1, §11.4)', () => {
  const databases = usePracticeDatabases();
  const logs = captureLogs();
  const app = useSharedApp(() => createProbeApp({ env: databases.apiEnv, logDestination: logs }));

  afterEach(async () => {
    await changeRegistry(databases.platformOwnerUrl, databases.practiceA.practiceId, {
      status: 'ACTIVE',
      schemaVersion: PRACTICE_SCHEMA_REQUIRED,
    });
  });

  function clientsCreated(): number {
    return app().get(PracticeConnectionManager).stats().creations;
  }

  async function runIn(practiceId: string, purpose: PracticePurpose): Promise<RunAnswer> {
    const txHost = app().get<PracticeTransactionHost>(getTransactionHostToken('practice'), {
      strict: false,
    });
    try {
      const identity = await app()
        .get(PracticeRunner)
        .runInPractice(
          practiceId,
          () => txHost.tx.practiceIdentity.findUniqueOrThrow({ where: { id: 1 } }),
          { purpose },
        );
      return { served: identity.practiceId };
    } catch (error) {
      return { refused: error instanceof PracticeUnavailableError ? error.reason : 'unexpected' };
    }
  }

  async function runInEveryPurpose(practiceId: string): Promise<Record<string, RunAnswer>> {
    const answers = await Promise.all(
      PURPOSES.map(async (purpose) => [purpose, await runIn(practiceId, purpose)] as const),
    );
    return Object.fromEntries(answers);
  }

  it.each(STATUS_TABLE)(
    'ADR-0005 §11.4 %s: the probe route and runInPractice for every purpose answer %s, also through a client cached while ACTIVE',
    async (status, answer) => {
      const { practiceId } = databases.practiceA;
      expect(await requestIdentity(app(), practiceId)).toEqual(served(practiceId));
      const creations = clientsCreated();
      const logged = reasonCodesOf(logs, practiceId).length;
      await changeRegistry(databases.platformOwnerUrl, practiceId, { status });
      expect({
        request: await requestIdentity(app(), practiceId),
        runInPractice: await runInEveryPurpose(practiceId),
        reasonCodes: reasonCodesOf(logs, practiceId).slice(logged),
        creations: clientsCreated(),
      }).toEqual({
        request: httpAnswer(answer, practiceId),
        runInPractice: Object.fromEntries(
          PURPOSES.map((purpose) => [purpose, runAnswer(answer, practiceId)]),
        ),
        reasonCodes: answer === 'UNAVAILABLE' ? ['PRACTICE_STATUS_UNAVAILABLE'] : [],
        // The status decides before any client is leased: no answer opens another one.
        creations,
      });
    },
  );

  it("ADR-0005 §11.4 after CONNECT is revoked from B's app role and its sessions end, B's cached client answers 503 and returns no data of B", async () => {
    const practice = databases.practiceB;
    expect(await requestIdentity(app(), practice.practiceId)).toEqual(served(practice.practiceId));
    const logged = reasonCodesOf(logs, practice.practiceId).length;
    const database = quoteIdent(practice.databaseName);
    const appRole = quoteIdent(practice.appRole);
    const owner = await practice.connectAsOwner();
    try {
      await owner.query(`REVOKE CONNECT ON DATABASE ${database} FROM ${appRole}`);
      // Waits until each session has ended (the timeout of pg_terminate_backend).
      await withClient(databases.superuserUrl(), (admin) =>
        admin.query(
          'SELECT pg_terminate_backend(pid, 10000) FROM pg_stat_activity WHERE usename = $1',
          [practice.appRole],
        ),
      );
      expect({
        request: await requestIdentity(app(), practice.practiceId),
        job: await runIn(practice.practiceId, 'job'),
        reasonCodes: reasonCodesOf(logs, practice.practiceId).slice(logged),
      }).toEqual({
        request: UNAVAILABLE,
        job: { refused: 'PRACTICE_CONNECTION_FAILED' },
        reasonCodes: ['PRACTICE_CONNECTION_FAILED'],
      });
    } finally {
      await owner.query(`GRANT CONNECT ON DATABASE ${database} TO ${appRole}`);
      await owner.end();
    }
    // The failed client was closed: with CONNECT granted again, a new one serves B.
    expect(await requestIdentity(app(), practice.practiceId)).toEqual(served(practice.practiceId));
  });

  it('ADR-0005 §6.8 a practice whose schema_version is older than PRACTICE_SCHEMA_REQUIRED answers 503 with Retry-After on every entry point', async () => {
    const { practiceId } = databases.practiceA;
    expect(await requestIdentity(app(), practiceId)).toEqual(served(practiceId));
    const logged = reasonCodesOf(logs, practiceId).length;
    await changeRegistry(databases.platformOwnerUrl, practiceId, {
      schemaVersion: OLDER_SCHEMA_VERSION,
    });
    expect({
      request: await requestIdentity(app(), practiceId),
      runInPractice: await runInEveryPurpose(practiceId),
      reasonCodes: reasonCodesOf(logs, practiceId).slice(logged),
    }).toEqual({
      request: UNAVAILABLE,
      runInPractice: Object.fromEntries(
        PURPOSES.map((purpose) => [purpose, { refused: 'PRACTICE_SCHEMA_BEHIND' }]),
      ),
      reasonCodes: ['PRACTICE_SCHEMA_BEHIND'],
    });
  });
});

/**
 * The practice context (ADR 0005 §2.5, §10, §11.9, §11.12): practice data is reached only with a
 * resolved practice; runInPractice and forEachPractice give each practice its own context and
 * isolate a failing one; jobs for A never write to B; and PracticeCache answers each practice
 * with its own value under concurrency.
 */
import { randomUUID } from 'node:crypto';
import type { ProvisionedPractice } from '@medibooker/db-migrate/testing';
import { getTransactionHostToken } from '@nestjs-cls/transactional';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PracticeCache } from '../../../src/common/tenancy/practice-cache.js';
import { PracticeContextMissingError } from '../../../src/common/tenancy/practice-errors.js';
import { PracticeRunner } from '../../../src/common/tenancy/practice-runner.js';
import type { PracticeTransactionHost } from '../../../src/common/tenancy/practice-transactional.adapter.js';
import { FixedClock } from '../../../src/common/time/fixed-clock.js';
import { PRACTICE_SCHEMA_REQUIRED } from '../../../src/generated/schema-versions.js';
import { captureLogs, type LogLine } from '../../support/log-capture.js';
import { usePracticeDatabases } from '../../support/practices.js';
import { PracticeContextProbeModule } from '../probes/practice-context-probe.module.js';
import { createProbeApp, useSharedApp } from '../probes/probe-app.js';
import { changeRegistry } from '../probes/registry.js';

const START = Temporal.Instant.from('2026-11-16T05:00:00Z');

/** A schema version older than every build's: migration names start with their timestamp. */
const OLDER_SCHEMA_VERSION = '20260101000000_older_schema';

/** What a log line about a skipped or failed practice job says, by practice. */
function jobFailuresOf(lines: readonly LogLine[]): Record<string, unknown> {
  const failures = lines.filter(
    (line) => line.msg === 'practice job skipped' || line.msg === 'practice job failed',
  );
  return Object.fromEntries(
    failures.map((line) => [
      String(line.practiceId),
      { msg: line.msg, reasonCode: line.reasonCode, err: line.err },
    ]),
  );
}

describe('the practice context (ADR 0005 §2.5)', () => {
  const databases = usePracticeDatabases();
  const logs = captureLogs();
  /** forEachPractice refuses it: its schema is behind. */
  let practiceC: ProvisionedPractice;
  /** forEachPractice runs it, and its job throws. */
  let practiceD: ProvisionedPractice;

  beforeAll(async () => {
    practiceC = await databases.provision();
    practiceD = await databases.provision();
  });

  const app = useSharedApp(() =>
    createProbeApp({
      env: databases.apiEnv,
      imports: [PracticeContextProbeModule],
      clock: new FixedClock(START),
      logDestination: logs,
    }),
  );

  function runner(): PracticeRunner {
    return app().get(PracticeRunner);
  }

  function cache(): PracticeCache {
    return app().get(PracticeCache);
  }

  function txHost(): PracticeTransactionHost {
    return app().get<PracticeTransactionHost>(getTransactionHostToken('practice'), {
      strict: false,
    });
  }

  /** The practice whose database the current context reaches. */
  async function contextIdentity(): Promise<string> {
    const identity = await txHost().tx.practiceIdentity.findUniqueOrThrow({ where: { id: 1 } });
    return identity.practiceId;
  }

  it('ADR-0005 §11.9 practice data access without a resolved practice throws PracticeContextMissingError', async () => {
    const load = vi.fn(() => Promise.resolve('loaded'));
    // Outside any request context: the client, a transaction and the cache refuse.
    expect(() => txHost().tx).toThrow(PracticeContextMissingError);
    await expect((async () => txHost().withTransaction(contextIdentity))()).rejects.toBeInstanceOf(
      PracticeContextMissingError,
    );
    await expect(cache().getOrLoad('identity', 60_000, load)).rejects.toBeInstanceOf(
      PracticeContextMissingError,
    );
    expect(load).not.toHaveBeenCalled();
    // In a request to a route without @PracticeScoped: 500, logged as that error.
    const requestId = randomUUID();
    const response = await request(app().getHttpServer())
      .get('/api/v1/probe/without-practice/practice-identity')
      .set('X-Request-Id', requestId);
    await logs.waitForAccessLine(requestId);
    expect({
      status: response.status,
      errors: logs
        .lines()
        .filter((line) => line.reqId === requestId && line.msg === 'unknown exception')
        .map((line) => line.err),
    }).toEqual({
      status: 500,
      errors: [expect.objectContaining({ type: 'PracticeContextMissingError' }) as unknown],
    });
  });

  it('ADR-0005 §2.5 runInPractice runs each practice in its own context, also nested', async () => {
    const a = databases.practiceA.practiceId;
    const b = databases.practiceB.practiceId;
    const seen = await runner().runInPractice(
      a,
      async (outer) => {
        const before = await contextIdentity();
        const inner = await runner().runInPractice(
          b,
          async (practice) => ({ practice: practice.id, identity: await contextIdentity() }),
          { purpose: 'job' },
        );
        return { outer: outer.id, before, inner, after: await contextIdentity() };
      },
      { purpose: 'job' },
    );
    expect(seen).toEqual({ outer: a, before: a, inner: { practice: b, identity: b }, after: a });
  });

  it('ADR-0005 §11.9 forEachPractice runs every ACTIVE practice in its own context and isolates a failing one', async () => {
    const a = databases.practiceA.practiceId;
    const b = databases.practiceB.practiceId;
    const c = practiceC.practiceId;
    const d = practiceD.practiceId;
    await changeRegistry(databases.platformOwnerUrl, c, { schemaVersion: OLDER_SCHEMA_VERSION });
    try {
      const logged = logs.lines().length;
      const seen = new Map<string, string>();
      const summary = await runner().forEachPractice(
        async (practice) => {
          seen.set(practice.id, await contextIdentity());
          if (practice.id === d) throw new Error('synthetic job failure');
        },
        { concurrency: 4 },
      );
      expect({
        summary,
        seen: Object.fromEntries(seen),
        failures: jobFailuresOf(logs.lines().slice(logged)),
      }).toEqual({
        summary: { succeeded: 2, failed: 2 },
        seen: { [a]: a, [b]: b, [d]: d },
        failures: {
          [c]: { msg: 'practice job skipped', reasonCode: 'PRACTICE_SCHEMA_BEHIND' },
          [d]: {
            msg: 'practice job failed',
            err: expect.objectContaining({ type: 'Error' }) as unknown,
          },
        },
      });
    } finally {
      await changeRegistry(databases.platformOwnerUrl, c, {
        schemaVersion: PRACTICE_SCHEMA_REQUIRED,
      });
    }
  });

  it('ADR-0005 §11.9 jobs for A never write to B, also when they run concurrently with jobs for B', async () => {
    const practices = [databases.practiceA, databases.practiceB];
    // A table that a later migration would create: the app role gets DML on it through the
    // default privileges of the first practice migration (02 §9).
    for (const practice of practices) {
      const owner = await practice.connectAsOwner();
      await owner.query('CREATE TABLE context_probe (practice_id uuid NOT NULL)');
      await owner.end();
    }
    try {
      const jobs = Array.from({ length: 20 }, (_, index) => practices[index % 2]!.practiceId);
      await Promise.all(
        jobs.map((practiceId) =>
          runner().runInPractice(
            practiceId,
            (practice) =>
              txHost().withTransaction(
                () =>
                  txHost().tx
                    .$executeRaw`INSERT INTO context_probe (practice_id) VALUES (${practice.id}::uuid)`,
              ),
            { purpose: 'job' },
          ),
        ),
      );
      const rows = await Promise.all(
        practices.map(async (practice) => {
          const owner = await practice.connectAsOwner();
          try {
            const result = await owner.query<{ practice_id: string }>(
              'SELECT practice_id FROM context_probe',
            );
            return result.rows.map((row) => row.practice_id);
          } finally {
            await owner.end();
          }
        }),
      );
      expect(rows).toEqual(
        practices.map((practice) => Array<string>(10).fill(practice.practiceId)),
      );
    } finally {
      for (const practice of practices) {
        const owner = await practice.connectAsOwner();
        await owner.query('DROP TABLE IF EXISTS context_probe');
        await owner.end();
      }
    }
  });

  it("ADR-0005 §11.12 concurrent cached reads for A and B return each practice's own value", async () => {
    const a = databases.practiceA.practiceId;
    const b = databases.practiceB.practiceId;
    // Both databases hold the singleton practice_identity with id 1: a key from table and id
    // alone would answer one practice with the other's row (ADR 0005 §10).
    const load = vi.fn(contextIdentity);
    const read = (practiceId: string): Promise<string> =>
      runner().runInPractice(practiceId, () => cache().getOrLoad('identity', 60_000, load), {
        purpose: 'job',
      });
    expect([await read(a), await read(b)]).toEqual([a, b]);
    const practiceIds = Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? a : b));
    expect(await Promise.all(practiceIds.map(read))).toEqual(practiceIds);
    // One load per practice: the concurrent reads were answered from the cache.
    expect(load).toHaveBeenCalledTimes(2);
    const keys = await Promise.all(
      [a, b].map((practiceId) =>
        runner().runInPractice(practiceId, () => Promise.resolve(cache().keyOf('identity')), {
          purpose: 'job',
        }),
      ),
    );
    expect(keys).toEqual([`${a}:1:identity`, `${b}:1:identity`]);
  });
});

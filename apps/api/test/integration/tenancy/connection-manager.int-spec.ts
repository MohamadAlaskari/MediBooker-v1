/**
 * The practice connection manager against real practice databases (ADR 0005 §2.2, §11.6, §11.7;
 * 02 §5): concurrent requests never read another practice's database, concurrent first use opens
 * one client, the LRU with its budgets and the creation rate, idle eviction on a stepped
 * FixedClock, and the identity and ACL checks that refuse a new client. Every test builds its own
 * app, so no cached client crosses tests; the FixedClock moves only when a test steps it.
 */
import { practiceNames } from '@medibooker/db-migrate';
import type { ProvisionedPractice } from '@medibooker/db-migrate/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PracticeLease } from '../../../src/common/tenancy/practice-client.js';
import { PracticeConnectionManager } from '../../../src/common/tenancy/practice-connection-manager.js';
import { PracticeUnavailableError } from '../../../src/common/tenancy/practice-errors.js';
import { PracticeRunner } from '../../../src/common/tenancy/practice-runner.js';
import { FixedClock } from '../../../src/common/time/fixed-clock.js';
import { captureLogs } from '../../support/log-capture.js';
import { usePracticeDatabases, type PracticeDatabases } from '../../support/practices.js';
import {
  requestIdentity,
  served,
  servedRoute,
  UNAVAILABLE,
  useProbeApps,
} from '../probes/probe-app.js';
import { changeRegistry } from '../probes/registry.js';
import { quoteIdent, withClient } from '../support/sql.js';

const START = Temporal.Instant.from('2026-11-16T05:00:00Z');

/** PRACTICE_CLIENT_IDLE_MS of every app in this file: the default (02 §7). */
const IDLE_MS = 60_000;

/** The practice whose database a lease's client reaches, from its `practice_identity`. */
async function identityThrough(lease: PracticeLease): Promise<string> {
  const identity = await lease.client.practiceIdentity.findUniqueOrThrow({ where: { id: 1 } });
  return identity.practiceId;
}

/** The sessions of a role on the cluster, as the superuser sees them. */
async function sessionsOf(databases: PracticeDatabases, role: string): Promise<number> {
  return withClient(databases.superuserUrl(), async (admin) => {
    const result = await admin.query<{ sessions: number }>(
      'SELECT count(*)::int AS sessions FROM pg_stat_activity WHERE usename = $1',
      [role],
    );
    return result.rows[0]?.sessions ?? 0;
  });
}

/** How each acquisition ended: `acquired` (the lease is released at once) or why it was refused. */
async function outcomesOf(acquisitions: Promise<PracticeLease>[]): Promise<string[]> {
  const settled = await Promise.allSettled(acquisitions);
  return settled.map((result) => {
    if (result.status === 'fulfilled') {
      result.value.release();
      return 'acquired';
    }
    return result.reason instanceof PracticeUnavailableError ? result.reason.reason : 'unexpected';
  });
}

describe('the practice connection manager (ADR 0005 §2.2)', () => {
  const databases = usePracticeDatabases();
  const startApp = useProbeApps(() => databases.apiEnv);
  let practiceC: ProvisionedPractice;

  beforeAll(async () => {
    practiceC = await databases.provision();
  });

  it("ADR-0005 §11.6 200 interleaved concurrent requests over A and B each read only their own practice's identity", async () => {
    const app = await startApp();
    // Listening before the burst: supertest would otherwise start the server once per request.
    await app.listen(0, '127.0.0.1');
    const practiceIds = Array.from(
      { length: 200 },
      (_, index) => (index % 2 === 0 ? databases.practiceA : databases.practiceB).practiceId,
    );
    const answers = await Promise.all(
      practiceIds.map((practiceId) => requestIdentity(app, practiceId)),
    );
    expect(answers).toEqual(practiceIds.map((practiceId) => served(practiceId)));
    expect(app.get(PracticeConnectionManager).stats()).toMatchObject({
      creations: 2,
      openClients: { request: 2, public: 0, job: 0 },
    });
  });

  it('ADR-0005 §2.2 concurrent first acquisitions of one practice share one new client', async () => {
    const app = await startApp();
    const manager = app.get(PracticeConnectionManager);
    const { practiceId } = databases.practiceA;
    const route = await servedRoute(app, practiceId, 'request');
    const leases = await Promise.all(
      Array.from({ length: 20 }, () => manager.acquire(route, 'request')),
    );
    try {
      expect(new Set(leases.map((lease) => lease.client)).size).toBe(1);
      expect(await identityThrough(leases[0]!)).toBe(practiceId);
      expect(manager.stats()).toMatchObject({ creations: 1, openClients: { request: 1 } });
    } finally {
      for (const lease of leases) lease.release();
    }
  });

  it('ADR-0005 §2.2 with PRACTICE_CLIENTS_MAX=2 a third practice evicts the least recently used idle client', async () => {
    const app = await startApp({
      env: { PRACTICE_CLIENTS_MAX: '2' },
      clock: new FixedClock(START),
    });
    const manager = app.get(PracticeConnectionManager);
    const a = databases.practiceA.practiceId;
    const b = databases.practiceB.practiceId;
    const c = practiceC.practiceId;
    // A, B, then A again: B is the least recently used client when C needs room.
    for (const practiceId of [a, b, a, c]) {
      expect(await requestIdentity(app, practiceId)).toEqual(served(practiceId));
    }
    expect(manager.stats()).toMatchObject({
      creations: 3,
      evictions: 1,
      openClients: { request: 2 },
    });
    // A kept its client; B needs a new one.
    expect(await requestIdentity(app, a)).toEqual(served(a));
    expect(manager.stats().creations).toBe(3);
    expect(await requestIdentity(app, b)).toEqual(served(b));
    expect(manager.stats().creations).toBe(4);
  });

  it('ADR-0005 §2.2 a client with a request in flight is never closed, by evictIdle() or for room', async () => {
    const clock = new FixedClock(START);
    const app = await startApp({ env: { PRACTICE_CLIENTS_MAX: '1' }, clock });
    const manager = app.get(PracticeConnectionManager);
    const a = databases.practiceA.practiceId;
    const b = databases.practiceB.practiceId;
    const leaseA = await manager.acquire(await servedRoute(app, a, 'request'), 'request');
    // The only client is in flight: B's acquisition waits instead of closing it.
    const pendingB = manager.acquire(await servedRoute(app, b, 'request'), 'request');
    clock.advance({ milliseconds: IDLE_MS });
    await manager.evictIdle();
    expect(await identityThrough(leaseA)).toBe(a);
    expect(manager.stats()).toMatchObject({ creations: 1, evictions: 0, waits: 1 });
    // Released, A's client is idle and least recently used: B takes its place.
    leaseA.release();
    const leaseB = await pendingB;
    try {
      expect(await identityThrough(leaseB)).toBe(b);
      expect(manager.stats()).toMatchObject({ creations: 2, evictions: 1 });
    } finally {
      leaseB.release();
    }
  });

  it('ADR-0005 §2.2 evictIdle() closes a client idle for PRACTICE_CLIENT_IDLE_MS, not 1 ms earlier', async () => {
    const clock = new FixedClock(START);
    const app = await startApp({ clock });
    const manager = app.get(PracticeConnectionManager);
    const practice = databases.practiceA;
    expect(await requestIdentity(app, practice.practiceId)).toEqual(served(practice.practiceId));
    expect(await sessionsOf(databases, practice.appRole)).toBeGreaterThan(0);
    clock.advance({ milliseconds: IDLE_MS - 1 });
    await manager.evictIdle();
    expect(manager.stats()).toMatchObject({ evictions: 0, openClients: { request: 1 } });
    clock.advance({ milliseconds: 1 });
    await manager.evictIdle();
    expect(manager.stats()).toMatchObject({
      evictions: 1,
      openClients: { request: 0, public: 0, job: 0 },
    });
    // The evicted client's pool is closed: its sessions end.
    await expect.poll(() => sessionsOf(databases, practice.appRole), { timeout: 10_000 }).toBe(0);
  });

  it('ADR-0005 §2.2 above PRACTICE_CLIENT_CREATIONS_PER_SECOND a public acquisition fails at once and a signed-in one waits for the next second', async () => {
    const clock = new FixedClock(START);
    const app = await startApp({ env: { PRACTICE_CLIENT_CREATIONS_PER_SECOND: '1' }, clock });
    const manager = app.get(PracticeConnectionManager);
    const a = databases.practiceA.practiceId;
    const b = databases.practiceB.practiceId;
    const leaseA = await manager.acquire(await servedRoute(app, a, 'request'), 'request');
    try {
      expect(
        await outcomesOf([manager.acquire(await servedRoute(app, b, 'public'), 'public')]),
      ).toEqual(['PRACTICE_CREATION_RATE_EXCEEDED']);
      expect(manager.stats()).toMatchObject({ creations: 1, waits: 0 });
      const pendingB = manager.acquire(await servedRoute(app, b, 'request'), 'request');
      expect(manager.stats()).toMatchObject({ creations: 1, waits: 1 });
      clock.advance({ seconds: 1 });
      const leaseB = await pendingB;
      try {
        expect(await identityThrough(leaseB)).toBe(b);
        expect(manager.stats().creations).toBe(2);
      } finally {
        leaseB.release();
      }
    } finally {
      leaseA.release();
    }
  });

  it("ADR-0005 §11.7 a registry entry that routes A to B's database is refused with 503 and PRACTICE_IDENTITY_MISMATCH", async () => {
    // A, whose entry is routed to B's database, and B, the target; both fresh, so no app has
    // cached a client of either. database_name is unique, so B's entry gives up its database
    // first. The route carries B's secret reference: its role is the one B's database admits.
    const routed = await databases.provision();
    const target = await databases.provision();
    await changeRegistry(databases.platformOwnerUrl, target.practiceId, { databaseName: null });
    await changeRegistry(databases.platformOwnerUrl, routed.practiceId, {
      databaseName: target.databaseName,
      appSecretRef: practiceNames(target.practiceId).appSecretRef,
      newRouteVersion: true,
    });
    const logs = captureLogs();
    const app = await startApp({ logDestination: logs });
    expect(await requestIdentity(app, routed.practiceId)).toEqual(UNAVAILABLE);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({
        msg: 'practice database refused',
        practiceId: routed.practiceId,
        clusterId: routed.clusterId,
        reasonCode: 'PRACTICE_IDENTITY_MISMATCH',
      }),
    );
    expect(app.get(PracticeConnectionManager).stats()).toMatchObject({
      identityMismatches: 1,
      openClients: { request: 0, public: 0, job: 0 },
    });
  });

  it('ADR-0005 §11.7 a database whose CONNECT is open to PUBLIC is refused with 503 and PRACTICE_ACL_OPEN', async () => {
    const practice = await databases.provision();
    const database = quoteIdent(practice.databaseName);
    const logs = captureLogs();
    const app = await startApp({ logDestination: logs });
    const owner = await practice.connectAsOwner();
    try {
      await owner.query(`GRANT CONNECT ON DATABASE ${database} TO PUBLIC`);
      expect(await requestIdentity(app, practice.practiceId)).toEqual(UNAVAILABLE);
      expect(logs.lines()).toContainEqual(
        expect.objectContaining({
          msg: 'practice database refused',
          practiceId: practice.practiceId,
          clusterId: practice.clusterId,
          reasonCode: 'PRACTICE_ACL_OPEN',
        }),
      );
      expect(app.get(PracticeConnectionManager).stats()).toMatchObject({ openAcls: 1 });
    } finally {
      await owner.query(`REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`);
      await owner.end();
    }
    // The refused client was never cached: with the ACL exact again, the practice is served.
    expect(await requestIdentity(app, practice.practiceId)).toEqual(served(practice.practiceId));
  });
});

describe('budgets with two clients used by signed-in requests (ADR 0005 §2.2)', () => {
  // Five ACTIVE practices: A and B, used by signed-in requests, and three others.
  const databases = usePracticeDatabases();
  const startApp = useProbeApps(() => databases.apiEnv);
  let others: ProvisionedPractice[];

  beforeAll(async () => {
    others = [
      await databases.provision(),
      await databases.provision(),
      await databases.provision(),
    ];
  });

  async function requestAAndB(app: NestExpressApplication): Promise<void> {
    for (const { practiceId } of [databases.practiceA, databases.practiceB]) {
      expect(await requestIdentity(app, practiceId)).toEqual(served(practiceId));
    }
  }

  it('ADR-0005 §2.2 with PRACTICE_CLIENTS_MAX=2, forEachPractice over five practices and a burst of public acquisitions evict neither', async () => {
    const app = await startApp({
      env: { PRACTICE_CLIENTS_MAX: '2' },
      clock: new FixedClock(START),
    });
    const manager = app.get(PracticeConnectionManager);
    await requestAAndB(app);
    const summary = await app
      .get(PracticeRunner)
      .forEachPractice(() => Promise.resolve(), { concurrency: 5 });
    const routes = await Promise.all(
      others.map(({ practiceId }) => servedRoute(app, practiceId, 'public')),
    );
    const burst = await outcomesOf(
      [...routes, ...routes, ...routes].map((route) => manager.acquire(route, 'public')),
    );
    // A and B ran on their own clients; the others found no room and waited in vain.
    expect(summary).toEqual({ succeeded: 2, failed: 3 });
    expect(burst).toEqual(Array<string>(9).fill('PRACTICE_CAPACITY_EXHAUSTED'));
    expect(manager.stats()).toMatchObject({
      creations: 2,
      evictions: 0,
      openClients: { request: 2, public: 0, job: 0 },
    });
    await requestAAndB(app);
    expect(manager.stats().creations).toBe(2);
  });

  it('ADR-0005 §2.2 with room for more, forEachPractice holds at most JOB_PRACTICE_CLIENTS_MAX job clients at once and keeps the request clients', async () => {
    const app = await startApp({
      env: {
        PRACTICE_CLIENTS_MAX: '4',
        JOB_PRACTICE_CLIENTS_MAX: '1',
        PRACTICE_CLIENT_CREATIONS_PER_SECOND: '100',
      },
      clock: new FixedClock(START),
    });
    const manager = app.get(PracticeConnectionManager);
    await requestAAndB(app);
    let mostJobClients = 0;
    let mostClients = 0;
    const summary = await app.get(PracticeRunner).forEachPractice(
      () => {
        const { openClients } = manager.stats();
        mostJobClients = Math.max(mostJobClients, openClients.job);
        mostClients = Math.max(
          mostClients,
          openClients.request + openClients.public + openClients.job,
        );
        return Promise.resolve();
      },
      { concurrency: 5 },
    );
    expect({ summary, mostJobClients, mostClients }).toEqual({
      summary: { succeeded: 5, failed: 0 },
      mostJobClients: 1,
      mostClients: 3,
    });
    // Each job client made room for the next; A and B kept theirs.
    expect(manager.stats()).toMatchObject({
      creations: 5,
      evictions: 2,
      openClients: { request: 2, job: 1 },
    });
    await requestAAndB(app);
    expect(manager.stats().creations).toBe(5);
  });
});

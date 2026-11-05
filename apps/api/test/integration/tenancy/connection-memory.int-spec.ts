/**
 * The heap cost of an open practice client (ADR 0005 §2.2, 08 F04): 20 practices with 20 open
 * clients, each with its full pool, measured against the booted app after forced garbage
 * collections. The cost per client gives the PRACTICE_CLIENTS_MAX default that fits 75 % of a
 * 512 MiB heap, at most 40 (02 §12). The numbers go to apps/api/reports/practice-client-memory.json
 * (gitignored) for the F04 commit body; the spec asserts only that the file was written.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { PracticeConnectionManager } from '../../../src/common/tenancy/practice-connection-manager.js';
import { FixedClock } from '../../../src/common/time/fixed-clock.js';
import { createTestApp } from '../../support/create-test-app.js';
import { usePracticeDatabases } from '../../support/practices.js';
import { servedRoute } from '../probes/probe-app.js';

const CLIENTS = 20;

/** PRACTICE_POOL_MAX of the measured app: the default (02 §7). */
const POOL_MAX = 3;

/** 75 % of a 512 MiB heap: what the open practice clients may take together (02 §12). */
const HEAP_BUDGET_BYTES = 0.75 * 512 * 1024 * 1024;

/** The highest default: ADR 0005 §2.2's 40. */
const CLIENTS_MAX_CEILING = 40;

const REPORT_FILE = fileURLToPath(
  new URL('../../../reports/practice-client-memory.json', import.meta.url),
);

interface Memory {
  readonly heapUsed: number;
  readonly external: number;
  readonly arrayBuffers: number;
  readonly rss: number;
}

/** V8's collector, which Node exposes only with --expose-gc; the flag applies to new contexts. */
function exposeGarbageCollector(): () => void {
  v8.setFlagsFromString('--expose-gc');
  return vm.runInNewContext('gc') as () => void;
}

/** The memory after two full collections, so only reachable objects count. */
function memoryAfterCollection(collect: () => void): Memory {
  collect();
  collect();
  const { heapUsed, external, arrayBuffers, rss } = process.memoryUsage();
  return { heapUsed, external, arrayBuffers, rss };
}

describe('memory per open practice client (08 F04)', () => {
  const databases = usePracticeDatabases();
  let practiceIds: string[] = [];

  beforeAll(async () => {
    const more: string[] = [];
    while (more.length < CLIENTS - 2) more.push((await databases.provision()).practiceId);
    practiceIds = [databases.practiceA.practiceId, databases.practiceB.practiceId, ...more];
  });

  it('08 F04 measures the heap of 20 open practice clients and writes the derived PRACTICE_CLIENTS_MAX default', async () => {
    const app = await createTestApp({
      env: {
        ...databases.apiEnv,
        PRACTICE_POOL_MAX: String(POOL_MAX),
        PRACTICE_CLIENTS_MAX: String(CLIENTS_MAX_CEILING),
        PRACTICE_CLIENT_CREATIONS_PER_SECOND: '1000',
      },
      // A clock that stands still: no client is idle long enough for the sweep.
      clock: new FixedClock(Temporal.Instant.from('2026-11-16T05:00:00Z')),
    });
    try {
      const manager = app.get(PracticeConnectionManager);
      // The routes are read first, so the platform client's own allocations are in the baseline.
      const routes = await Promise.all(
        practiceIds.map((practiceId) => servedRoute(app, practiceId, 'request')),
      );
      const collect = exposeGarbageCollector();
      const baseline = memoryAfterCollection(collect);
      for (const route of routes) {
        const lease = await manager.acquire(route, 'request');
        try {
          // Model queries, as handlers run them, on a full pool, as a client under load holds it.
          await Promise.all(
            Array.from({ length: POOL_MAX }, () =>
              lease.client.practiceIdentity.findUniqueOrThrow({ where: { id: 1 } }),
            ),
          );
        } finally {
          lease.release();
        }
      }
      expect(manager.stats().openClients.request).toBe(CLIENTS);
      const after = memoryAfterCollection(collect);
      const baselineBytes = baseline.heapUsed + baseline.external;
      const perClientBytes = Math.round(
        (after.heapUsed + after.external - baselineBytes) / CLIENTS,
      );
      const report = {
        clients: CLIENTS,
        poolConnectionsPerClient: POOL_MAX,
        node: process.version,
        baselineBytes: baseline,
        deltaBytes: {
          heapUsed: after.heapUsed - baseline.heapUsed,
          external: after.external - baseline.external,
          arrayBuffers: after.arrayBuffers - baseline.arrayBuffers,
          rss: after.rss - baseline.rss,
        },
        perClientBytes,
        heapBudgetBytes: HEAP_BUDGET_BYTES,
        derivedPracticeClientsMax: Math.min(
          CLIENTS_MAX_CEILING,
          Math.floor((HEAP_BUDGET_BYTES - baselineBytes) / perClientBytes),
        ),
      };
      mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
      writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
      expect(JSON.parse(readFileSync(REPORT_FILE, 'utf8'))).toEqual(report);
    } finally {
      await app.close();
    }
  });
});

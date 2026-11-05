import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { Clock } from '../time/clock.js';
import type { PracticeClient, PracticeLease } from './practice-client.js';
import { PracticeClientOpener } from './practice-client-opener.js';
import { PracticeConnectionMetrics } from './practice-connection-metrics.js';
import { PracticeUnavailableError } from './practice-errors.js';
import type { PracticePurpose, PracticeRoute } from './practice-route.js';

/** How long `acquire()` waits for a release when no client can be closed (02 §5 item 5). */
const ACQUIRE_WAIT_MS = 2000;

/** The window of PRACTICE_CLIENT_CREATIONS_PER_SECOND. */
const CREATION_WINDOW_MS = 1000;

/** The shortest pause before a creation is tried again, so a stopped clock cannot spin. */
const MIN_RETRY_DELAY_MS = 10;

/** One cached client: of one practice and route version (02 §5 item 2). */
interface Entry {
  readonly key: string;
  readonly practiceId: string;
  readonly routeVersion: number;
  /** The one creation that concurrent first acquisitions share. */
  readonly opened: Promise<PracticeClient>;
  client: PracticeClient | undefined;
  /** Leases not released yet, and acquisitions waiting for the creation. */
  inFlight: number;
  lastPurpose: PracticePurpose;
  /** Epoch milliseconds from the Clock, when the client was last acquired or released. */
  lastUsedAt: number;
  /** When a signed-in request last used the client. */
  requestUsedAt: number | undefined;
  /** Out of the cache; disconnected once nothing is in flight. */
  closed: boolean;
}

/** Why a new client cannot be created yet. */
type Blocker = 'capacity' | 'rate';

interface Wait {
  expired: boolean;
  readonly timer: NodeJS.Timeout;
}

export interface PracticeConnectionStats {
  /** Cached clients by the purpose they serve; a client a request used recently counts as `request`. */
  readonly openClients: Readonly<Record<PracticePurpose, number>>;
  readonly creations: number;
  readonly evictions: number;
  readonly waits: number;
  readonly authenticationFailures: number;
  readonly identityMismatches: number;
  readonly openAcls: number;
}

/**
 * The practice clients of this process (02 §5, ADR 0005 §2.2): a Map from practice id and route
 * version to a client, whose insertion order is the LRU order, with reference counts. The limits
 * are never exceeded: at most PRACTICE_CLIENTS_MAX clients, of which public acquisitions hold at
 * most PUBLIC_PRACTICE_CLIENTS_MAX and jobs at most JOB_PRACTICE_CLIENTS_MAX, and at most
 * PRACTICE_CLIENT_CREATIONS_PER_SECOND creations per second. A public or job acquisition closes
 * only an idle client that no signed-in request used within PRACTICE_CLIENT_IDLE_MS, so crawlers
 * and jobs cannot push signed-in users out. Every time comes from the Clock; waiting uses timers.
 */
@Injectable()
export class PracticeConnectionManager implements OnModuleInit, OnModuleDestroy {
  private readonly entries = new Map<string, Entry>();
  private readonly entriesOfLeases = new WeakMap<PracticeLease, Entry>();
  /** Creation times within the last second, oldest first. */
  private readonly creationTimes: number[] = [];
  /** Acquisitions waiting for a release, a closed client or the creation window. */
  private readonly waiters = new Set<() => void>();
  private sweeper: NodeJS.Timeout | undefined;
  private readonly clientsMax: number;
  private readonly publicClientsMax: number;
  private readonly jobClientsMax: number;
  private readonly creationsPerSecond: number;
  private readonly idleMs: number;

  constructor(
    @Inject(ENV) env: Env,
    private readonly clock: Clock,
    private readonly opener: PracticeClientOpener,
    private readonly metrics: PracticeConnectionMetrics,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(PracticeConnectionManager.name);
    this.clientsMax = env.PRACTICE_CLIENTS_MAX;
    this.publicClientsMax = env.PUBLIC_PRACTICE_CLIENTS_MAX;
    this.jobClientsMax = env.JOB_PRACTICE_CLIENTS_MAX;
    this.creationsPerSecond = env.PRACTICE_CLIENT_CREATIONS_PER_SECOND;
    this.idleMs = env.PRACTICE_CLIENT_IDLE_MS;
  }

  /** Starts the sweep of idle clients; a timer only, no I/O. */
  onModuleInit(): void {
    this.sweeper = setInterval(
      () => {
        this.evictIdle().catch((error: unknown) => {
          this.logger.error({ err: error }, 'practice client sweep failed');
        });
      },
      Math.max(1, Math.floor(this.idleMs / 4)),
    );
    this.sweeper.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.sweeper);
    const entries = [...this.entries.values()];
    for (const entry of entries) this.remove(entry);
    await Promise.all(entries.map((entry) => this.disconnect(entry)));
  }

  /**
   * A lease of the route's client for a purpose: the cached client, or a new one when the
   * budgets allow it. When none can be created, it waits up to 2 s for a release, then throws
   * PracticeUnavailableError; a public acquisition above the creation rate fails at once.
   */
  async acquire(route: PracticeRoute, purpose: PracticePurpose): Promise<PracticeLease> {
    const key = entryKey(route);
    let wait: Wait | undefined;
    try {
      for (;;) {
        const admitted = this.entries.get(key) ?? this.admit(route, purpose);
        if (typeof admitted !== 'string') return await this.lease(admitted, purpose);
        if (admitted === 'rate' && purpose === 'public') {
          throw new PracticeUnavailableError(route.id, 'PRACTICE_CREATION_RATE_EXCEEDED');
        }
        if (wait === undefined) {
          wait = this.startWait();
          this.metrics.waits += 1;
        }
        if (wait.expired) {
          throw new PracticeUnavailableError(route.id, 'PRACTICE_CAPACITY_EXHAUSTED');
        }
        await this.nextChance(admitted === 'rate' ? this.creationDelayMs() : undefined);
      }
    } finally {
      if (wait !== undefined) clearTimeout(wait.timer);
    }
  }

  /**
   * Takes the client of a lease out of the cache after its connection failed (02 §5 item 7):
   * the next acquisition opens a new one, and this one is closed once nothing is in flight.
   */
  close(lease: PracticeLease): void {
    const entry = this.entriesOfLeases.get(lease);
    if (entry === undefined || entry.closed) return;
    this.remove(entry);
    if (entry.inFlight === 0) void this.disconnect(entry);
  }

  /**
   * Closes the clients idle for PRACTICE_CLIENT_IDLE_MS and those of an older route version than
   * another client of the same practice, once nothing is in flight (02 §5 item 6). The sweep
   * calls it; tests step the FixedClock and call it directly.
   */
  async evictIdle(): Promise<void> {
    const now = this.now();
    const newestVersions = new Map<string, number>();
    for (const entry of this.entries.values()) {
      const newest = newestVersions.get(entry.practiceId) ?? entry.routeVersion;
      newestVersions.set(entry.practiceId, Math.max(newest, entry.routeVersion));
    }
    const closing: Promise<void>[] = [];
    for (const entry of [...this.entries.values()]) {
      if (entry.inFlight > 0 || entry.client === undefined) continue;
      const idle = now - entry.lastUsedAt >= this.idleMs;
      const outdated = entry.routeVersion < (newestVersions.get(entry.practiceId) ?? 0);
      if (!idle && !outdated) continue;
      this.metrics.evictions += 1;
      this.remove(entry);
      closing.push(this.disconnect(entry));
    }
    await Promise.all(closing);
  }

  stats(): PracticeConnectionStats {
    const now = this.now();
    const openClients: Record<PracticePurpose, number> = { request: 0, public: 0, job: 0 };
    for (const entry of this.entries.values()) openClients[this.purposeOf(entry, now)] += 1;
    const { creations, evictions, waits, authenticationFailures, identityMismatches, openAcls } =
      this.metrics;
    return {
      openClients,
      creations,
      evictions,
      waits,
      authenticationFailures,
      identityMismatches,
      openAcls,
    };
  }

  /** A new entry for the route, or what blocks it; it may close an idle client to make room. */
  private admit(route: PracticeRoute, purpose: PracticePurpose): Entry | Blocker {
    const now = this.now();
    while (
      this.creationTimes.length > 0 &&
      now - (this.creationTimes[0] ?? now) >= CREATION_WINDOW_MS
    ) {
      this.creationTimes.shift();
    }
    if (this.creationTimes.length >= this.creationsPerSecond) return 'rate';
    if (purpose !== 'request') {
      const budget = purpose === 'public' ? this.publicClientsMax : this.jobClientsMax;
      const held = [...this.entries.values()].filter(
        (entry) => this.purposeOf(entry, now) === purpose,
      ).length;
      const ownPurpose = (entry: Entry): boolean => this.purposeOf(entry, now) === purpose;
      if (held >= budget && !this.evictLeastRecentlyUsed(purpose, now, ownPurpose)) {
        return 'capacity';
      }
    }
    if (
      this.entries.size >= this.clientsMax &&
      !this.evictLeastRecentlyUsed(purpose, now, () => true)
    ) {
      return 'capacity';
    }
    return this.create(route, purpose, now);
  }

  private create(route: PracticeRoute, purpose: PracticePurpose, now: number): Entry {
    this.creationTimes.push(now);
    this.metrics.creations += 1;
    const entry: Entry = {
      key: entryKey(route),
      practiceId: route.id,
      routeVersion: route.routeVersion,
      opened: this.opener.open(route).then(
        (client) => {
          entry.client = client;
          return client;
        },
        (error: unknown) => {
          // Concurrent acquisitions share this failure; the next one tries again.
          this.remove(entry);
          throw error;
        },
      ),
      client: undefined,
      inFlight: 0,
      lastPurpose: purpose,
      lastUsedAt: now,
      requestUsedAt: undefined,
      closed: false,
    };
    this.entries.set(entry.key, entry);
    return entry;
  }

  private async lease(entry: Entry, purpose: PracticePurpose): Promise<PracticeLease> {
    entry.inFlight += 1;
    let client: PracticeClient;
    try {
      client = await entry.opened;
    } catch (error) {
      entry.inFlight -= 1;
      throw error;
    }
    this.markUsed(entry, purpose);
    let released = false;
    const lease: PracticeLease = {
      practiceId: entry.practiceId,
      client,
      release: () => {
        if (released) return;
        released = true;
        this.release(entry, purpose);
      },
    };
    this.entriesOfLeases.set(lease, entry);
    return lease;
  }

  /** Records a use and moves the entry to the end of the LRU order. */
  private markUsed(entry: Entry, purpose: PracticePurpose): void {
    const now = this.now();
    entry.lastPurpose = purpose;
    entry.lastUsedAt = now;
    if (purpose === 'request') entry.requestUsedAt = now;
    if (this.entries.get(entry.key) === entry) {
      this.entries.delete(entry.key);
      this.entries.set(entry.key, entry);
    }
  }

  private release(entry: Entry, purpose: PracticePurpose): void {
    entry.inFlight -= 1;
    const now = this.now();
    entry.lastUsedAt = now;
    if (purpose === 'request') entry.requestUsedAt = now;
    if (entry.closed && entry.inFlight === 0) void this.disconnect(entry);
    this.wakeWaiters();
  }

  /** The purpose a client serves for the budgets: `request` while a request used it recently. */
  private purposeOf(entry: Entry, now: number): PracticePurpose {
    return this.usedByRequestRecently(entry, now) ? 'request' : entry.lastPurpose;
  }

  private usedByRequestRecently(entry: Entry, now: number): boolean {
    return entry.requestUsedAt !== undefined && now - entry.requestUsedAt < this.idleMs;
  }

  /**
   * Closes the least recently used client that nothing has in flight and that `accepts`; for a
   * public or job acquisition, only one that no request used within PRACTICE_CLIENT_IDLE_MS.
   */
  private evictLeastRecentlyUsed(
    purpose: PracticePurpose,
    now: number,
    accepts: (entry: Entry) => boolean,
  ): boolean {
    for (const entry of this.entries.values()) {
      if (entry.inFlight > 0 || entry.client === undefined || !accepts(entry)) continue;
      if (purpose !== 'request' && this.usedByRequestRecently(entry, now)) continue;
      this.metrics.evictions += 1;
      this.remove(entry);
      void this.disconnect(entry);
      return true;
    }
    return false;
  }

  /** Takes an entry out of the cache; waiting acquisitions may now have room. */
  private remove(entry: Entry): void {
    entry.closed = true;
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    this.wakeWaiters();
  }

  private async disconnect(entry: Entry): Promise<void> {
    try {
      await entry.client?.$disconnect();
    } catch (error) {
      this.logger.warn(
        { err: error, practiceId: entry.practiceId },
        'practice client close failed',
      );
    }
  }

  private startWait(): Wait {
    const wait: Wait = {
      expired: false,
      timer: setTimeout(() => {
        wait.expired = true;
        this.wakeWaiters();
      }, ACQUIRE_WAIT_MS),
    };
    wait.timer.unref();
    return wait;
  }

  /** Resolves on the next release or closed client, or after `delayMs`. */
  private nextChance(delayMs: number | undefined): Promise<void> {
    return new Promise((resolve) => {
      const timer = delayMs === undefined ? undefined : setTimeout(wake, delayMs);
      timer?.unref();
      const waiters = this.waiters;
      function wake(): void {
        waiters.delete(wake);
        clearTimeout(timer);
        resolve();
      }
      waiters.add(wake);
    });
  }

  private wakeWaiters(): void {
    for (const wake of [...this.waiters]) wake();
  }

  /** Until the oldest creation of the window leaves it. */
  private creationDelayMs(): number {
    const oldest = this.creationTimes[0] ?? this.now();
    return Math.max(MIN_RETRY_DELAY_MS, oldest + CREATION_WINDOW_MS - this.now());
  }

  private now(): number {
    return this.clock.now().epochMilliseconds;
  }
}

function entryKey(route: PracticeRoute): string {
  return `${route.id}:${String(route.routeVersion)}`;
}

import { randomBytes } from 'node:crypto';
import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PlatformTransactionHost } from '../../common/database/platform-transactional.js';
import { AuthSecrets } from '../../common/security/auth-secrets.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf } from '../../common/time/convert.js';

/** How long a browser stays known without a sign-in: as long as its cookie lives. */
const KNOWN_DAYS = 400;

/** What a sign-in's browser is to its account. */
export interface DeviceRecognition {
  /** The key to put in the device cookie; undefined for a client without cookies (the app). */
  readonly key: string | undefined;
  /** The account signed in with this browser before. */
  readonly known: boolean;
}

/** A browser the account knows, with its own count of failed sign-ins. */
export interface KnownDeviceState {
  readonly id: string;
  readonly failedCount: number;
  readonly failedAt: Date | null;
  readonly lockedUntil: Date | null;
}

/** A known browser after a success: nothing counts against it any more. */
const NO_DEVICE_FAILURES = { failedCount: 0, failedAt: null, lockedUntil: null } as const;

/**
 * The browsers an account signed in with (A04, E10). Only a keyed hash of the device cookie together
 * with the account is kept: the same browser of two accounts gives two unrelated rows, and a copy of
 * the database with a cookie of a shared computer does not tell which accounts used it (the security
 * review of A04 part 2b). A rotation of the auth secret makes every browser new once.
 */
@Injectable()
export class KnownDevices {
  constructor(
    @InjectTransactionHost('platform') private readonly txHost: PlatformTransactionHost,
    private readonly clock: Clock,
    private readonly secrets: AuthSecrets,
  ) {}

  /**
   * The browser of a presented key, if the account knows it: in the caller's transaction, under the
   * lock of the account's row. A sign-in from it counts against it alone (SignInAttempts).
   */
  async find(userId: string, presented: string): Promise<KnownDeviceState | undefined> {
    const row = await this.txHost.tx.knownDevice.findFirst({
      where: {
        userId,
        deviceHash: await this.hashOf(userId, presented),
        lastSeenAt: { gte: dbInstantOf(this.knownSince()) },
      },
      select: { id: true, failedCount: true, failedAt: true, lockedUntil: true },
    });
    return row ?? undefined;
  }

  /** In the caller's transaction, after the sign-in passed; under the lock of the account's row. */
  async recognise(
    userId: string,
    presented: string | undefined,
    withCookies: boolean,
  ): Promise<DeviceRecognition> {
    const db = this.txHost.tx;
    const now = this.clock.now();
    await db.knownDevice.deleteMany({
      where: { userId, lastSeenAt: { lt: dbInstantOf(this.knownSince()) } },
    });
    if (!withCookies) return { key: undefined, known: false };
    const key = presented ?? randomBytes(32).toString('base64url');
    const deviceHash = await this.hashOf(userId, key);
    const { count } = await db.knownDevice.updateMany({
      where: { userId, deviceHash },
      data: { lastSeenAt: dbInstantOf(now), ...NO_DEVICE_FAILURES },
    });
    if (count > 0) return { key, known: true };
    await db.knownDevice.create({
      data: { userId, deviceHash, firstSeenAt: dbInstantOf(now), lastSeenAt: dbInstantOf(now) },
    });
    return { key, known: false };
  }

  /** A new password clears what every browser of the account counted. */
  async clearFailures(userId: string): Promise<void> {
    await this.txHost.tx.knownDevice.updateMany({ where: { userId }, data: NO_DEVICE_FAILURES });
  }

  /** Securing an account forgets every browser: whoever else signed in is a stranger again. */
  async forget(userId: string): Promise<void> {
    await this.txHost.tx.knownDevice.deleteMany({ where: { userId } });
  }

  private knownSince(): Temporal.Instant {
    return this.clock.now().subtract({ hours: KNOWN_DAYS * 24 });
  }

  private hashOf(userId: string, key: string): Promise<string> {
    return this.secrets.derive('known-device', `${userId}:${key}`);
  }
}

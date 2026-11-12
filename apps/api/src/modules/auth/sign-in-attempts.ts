import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PlatformTransactionHost } from '../../common/database/platform-transactional.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf, instantOf } from '../../common/time/convert.js';
import { capReached, decayedFailures, lockedUntilAfter } from './domain/auth.rules.js';
import { KnownDevices } from './known-devices.js';

/** What an attempt reads under the lock of the account's row. */
interface AttemptRow {
  readonly id: string;
  readonly password_hash: string;
  readonly failed_login_count: number;
  readonly locked_until: Date | null;
  readonly failed_login_at: Date | null;
  readonly failed_since_success: number;
}

/** An attempt that has been counted. `waiting`: too many failures, so the password does not count. */
export interface SignInAttempt {
  readonly userId: string;
  readonly passwordHash: string;
  readonly waiting: boolean;
  /** The browser the account knows, which counted this attempt; undefined for any other client. */
  readonly knownDeviceId: string | undefined;
}

/** The account's count for clients it does not know, after a success or a new password. */
export const NO_FAILURES = {
  failedLoginCount: 0,
  failedLoginAt: null,
  lockedUntil: null,
  failedSinceSuccess: 0,
} as const;

function waitsAt(lockedUntil: Date | null, now: Temporal.Instant): boolean {
  return lockedUntil !== null && Temporal.Instant.compare(instantOf(lockedUntil), now) > 0;
}

/**
 * Every place that checks a password counts through here, before it looks at the password and under
 * the lock of the account's row. So guesses sent at the same moment cannot all pass the wait on one
 * count, and no route is a way around it. A success clears the count, and time wears it down
 * (decayedFailures): every attempt counts on top of what is left of the failures before.
 *
 * A browser that presents a device key the account knows counts on its own (OWASP device cookies, the
 * security review of A04 part 2b): a stranger's guesses never make the owner's browser wait, and its
 * failures never make the others wait. Every other client counts on the account, and after
 * MAX_FAILURES_SINCE_SUCCESS of them only a new password lets such a client in again.
 */
@Injectable()
export class SignInAttempts {
  constructor(
    @InjectTransactionHost('platform') private readonly txHost: PlatformTransactionHost,
    private readonly clock: Clock,
    private readonly devices: KnownDevices,
  ) {}

  async count(email: string, deviceKey?: string): Promise<SignInAttempt | undefined> {
    const now = this.clock.now();
    return this.txHost.withTransaction(async () => {
      const db = this.txHost.tx;
      const [user] = await db.$queryRaw<AttemptRow[]>`
        SELECT id, password_hash, failed_login_count, locked_until, failed_login_at,
               failed_since_success
        FROM users
        WHERE email = ${email}::citext
        FOR UPDATE`;
      if (user === undefined) return undefined;
      const device =
        deviceKey === undefined ? undefined : await this.devices.find(user.id, deviceKey);
      if (device !== undefined) {
        const waiting = waitsAt(device.lockedUntil, now);
        if (!waiting) {
          const before = device.failedAt === null ? null : instantOf(device.failedAt);
          const failures = decayedFailures(device.failedCount, before, now) + 1;
          const until = lockedUntilAfter(failures, now);
          await db.knownDevice.update({
            where: { id: device.id },
            data: {
              failedCount: failures,
              failedAt: dbInstantOf(now),
              ...(until === undefined ? {} : { lockedUntil: dbInstantOf(until) }),
            },
          });
        }
        return {
          userId: user.id,
          passwordHash: user.password_hash,
          waiting,
          knownDeviceId: device.id,
        };
      }
      const waiting = waitsAt(user.locked_until, now) || capReached(user.failed_since_success);
      if (!waiting) {
        const before = user.failed_login_at === null ? null : instantOf(user.failed_login_at);
        const failures = decayedFailures(user.failed_login_count, before, now) + 1;
        const until = lockedUntilAfter(failures, now);
        await db.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: failures,
            failedLoginAt: dbInstantOf(now),
            failedSinceSuccess: { increment: 1 },
            ...(until === undefined ? {} : { lockedUntil: dbInstantOf(until) }),
          },
        });
      }
      return {
        userId: user.id,
        passwordHash: user.password_hash,
        waiting,
        knownDeviceId: undefined,
      };
    });
  }
}

import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PlatformTransactionHost } from '../../common/database/platform-transactional.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf, instantOf } from '../../common/time/convert.js';
import { lockedUntilAfter } from './domain/auth.rules.js';

/** What an attempt reads under the lock of the account's row. */
interface AttemptRow {
  readonly id: string;
  readonly password_hash: string;
  readonly failed_login_count: number;
  readonly locked_until: Date | null;
}

/** An attempt that has been counted. `waiting`: too many failures, so the password does not count. */
export interface SignInAttempt {
  readonly userId: string;
  readonly passwordHash: string;
  readonly waiting: boolean;
}

/**
 * Every place that checks a password counts through here, before it looks at the password and under
 * the lock of the account's row. So guesses sent at the same moment cannot all pass the wait on one
 * count, and no route is a way around it. A success clears the count.
 */
@Injectable()
export class SignInAttempts {
  constructor(
    @InjectTransactionHost('platform') private readonly txHost: PlatformTransactionHost,
    private readonly clock: Clock,
  ) {}

  async count(email: string): Promise<SignInAttempt | undefined> {
    const now = this.clock.now();
    return this.txHost.withTransaction(async () => {
      const db = this.txHost.tx;
      const [user] = await db.$queryRaw<AttemptRow[]>`
        SELECT id, password_hash, failed_login_count, locked_until
        FROM users
        WHERE email = ${email}::citext
        FOR UPDATE`;
      if (user === undefined) return undefined;
      const waiting =
        user.locked_until !== null &&
        Temporal.Instant.compare(instantOf(user.locked_until), now) > 0;
      if (!waiting) {
        const failures = user.failed_login_count + 1;
        const until = lockedUntilAfter(failures, now);
        await db.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: failures,
            ...(until === undefined ? {} : { lockedUntil: dbInstantOf(until) }),
          },
        });
      }
      return { userId: user.id, passwordHash: user.password_hash, waiting };
    });
  }
}

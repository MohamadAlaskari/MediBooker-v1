import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PlatformTransactionHost } from '../../common/database/platform-transactional.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf } from '../../common/time/convert.js';
import type { AccountNotificationTemplate } from '../../generated/platform/enums.js';

export interface AccountNotificationRequest {
  readonly userId: string;
  readonly template: AccountNotificationTemplate;
  /** One e-mail per reason. */
  readonly dedupeKey: string;
  readonly accountTokenId: string;
}

/**
 * The only way to queue an account e-mail (A02): inside the transaction of its reason, never after
 * the commit, so a committed change always has its e-mail and a failed one has none.
 */
@Injectable()
export class AccountNotifications {
  constructor(
    @InjectTransactionHost('platform') private readonly txHost: PlatformTransactionHost,
    private readonly clock: Clock,
  ) {}

  async enqueue(request: AccountNotificationRequest): Promise<void> {
    await this.txHost.tx.accountNotification.create({
      data: { ...request, nextAttemptAt: dbInstantOf(this.clock.now()) },
    });
  }
}

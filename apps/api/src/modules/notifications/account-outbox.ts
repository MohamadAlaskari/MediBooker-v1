import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PlatformPrismaService } from '../../common/database/platform-prisma.service.js';
import { AuthSecrets } from '../../common/security/auth-secrets.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf, instantOf } from '../../common/time/convert.js';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { renderAccountEmail } from './account-email.js';
import { LEASE_MINUTES, nextAttemptAfter } from './domain/outbox.rules.js';
import { EmailSender } from './email-sender.js';

const BATCH_SIZE = 20;

export interface OutboxResult {
  readonly succeeded: number;
  readonly failed: number;
}

/**
 * Sends the queued account e-mails (A02). A run first takes its rows with `FOR UPDATE SKIP LOCKED`
 * and a lease in one short statement, then sends outside any transaction. So several instances
 * share the work, and a run that dies leaves rows that come back when the lease ends.
 */
@Injectable()
export class AccountOutbox implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly platform: PlatformPrismaService,
    private readonly clock: Clock,
    private readonly secrets: AuthSecrets,
    private readonly sender: EmailSender,
    private readonly logger: PinoLogger,
    @Inject(ENV) private readonly env: Env,
  ) {
    logger.setContext(AccountOutbox.name);
  }

  onApplicationBootstrap(): void {
    if (this.env.OUTBOX_POLL_SECONDS === 0) return;
    this.timer = setInterval(() => {
      void this.poll();
    }, this.env.OUTBOX_POLL_SECONDS * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** One run nobody waits for. Never rejects, and never overlaps with itself. */
  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.processDue();
      if (result.succeeded + result.failed > 0) {
        this.logger.info(result, 'account e-mails processed');
      }
    } catch (error) {
      this.logger.error({ err: error }, 'account e-mails not processed');
    } finally {
      this.running = false;
    }
  }

  /** The due messages of this moment: what the job runs, and what the tests drive. */
  async processDue(): Promise<OutboxResult> {
    const now = this.clock.now();
    const lease = dbInstantOf(now.add({ minutes: LEASE_MINUTES }));
    const taken = await this.platform.$queryRaw<{ id: string; attempts: number }[]>`
      UPDATE account_notifications
      SET attempts = attempts + 1, next_attempt_at = ${lease}
      WHERE id IN (
        SELECT id FROM account_notifications
        WHERE status = 'PENDING' AND next_attempt_at <= ${dbInstantOf(now)}
        ORDER BY next_attempt_at
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, attempts`;
    let succeeded = 0;
    let failed = 0;
    for (const { id, attempts } of taken) {
      if (await this.send(id, attempts)) succeeded += 1;
      else failed += 1;
    }
    return { succeeded, failed };
  }

  private async send(id: string, attempts: number): Promise<boolean> {
    const row = await this.platform.accountNotification.findUnique({
      where: { id },
      select: {
        template: true,
        user: { select: { email: true, locale: true } },
        accountToken: { select: { id: true, expiresAt: true, usedAt: true } },
      },
    });
    // An account can go in the meantime, and its e-mails with it: nothing to send, or to record.
    if (row === null) return false;
    const now = this.clock.now();
    const { accountToken: token } = row;
    // A link that cannot work any more helps nobody: the person asks for a new one.
    if (token?.usedAt !== null || Temporal.Instant.compare(instantOf(token.expiresAt), now) <= 0) {
      await this.platform.accountNotification.updateMany({
        where: { id },
        data: { status: 'FAILED' },
      });
      return false;
    }
    try {
      const email = renderAccountEmail(
        row.template,
        row.user.locale,
        this.env.PUBLIC_WEB_URL,
        await this.secrets.accountTokenOf(token.id),
      );
      await this.sender.send({ to: row.user.email, ...email });
      await this.platform.accountNotification.updateMany({
        where: { id },
        data: { status: 'SENT', sentAt: dbInstantOf(now) },
      });
      return true;
    } catch (error) {
      this.logger.warn({ err: error }, 'account e-mail not sent');
      const next = nextAttemptAfter(attempts, now);
      await this.platform.accountNotification.updateMany({
        where: { id },
        data: next === undefined ? { status: 'FAILED' } : { nextAttemptAt: dbInstantOf(next) },
      });
      return false;
    }
  }
}

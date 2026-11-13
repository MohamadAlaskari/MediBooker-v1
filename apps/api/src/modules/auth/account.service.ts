import { randomBytes, randomUUID } from 'node:crypto';
import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PlatformTransactionHost } from '../../common/database/platform-transactional.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { FIELD_ERROR_MESSAGES } from '../../common/errors/field-error-codes.js';
import { AuthSecrets, sha256 } from '../../common/security/auth-secrets.js';
import {
  ANONYMOUS_ACTOR,
  auditActorOf,
  PlatformAudit,
} from '../../common/security/platform-audit.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf, instantOf } from '../../common/time/convert.js';
import type {
  AccountNotificationTemplate,
  AccountTokenPurpose,
} from '../../generated/platform/enums.js';
import { AccountNotifications } from '../notifications/account-notifications.js';
import { hashPassword, verifyPassword } from './domain/password.js';
import { isBreachedPassword } from './domain/password-policy.js';
import { KnownDevices } from './known-devices.js';
import { NO_FAILURES, SignInAttempts } from './sign-in-attempts.js';

/** ADR 0004 §8. */
const ACCOUNT_TOKEN_MINUTES = 30;
/**
 * The "this was not me" link of the security e-mails (A04): a week, because whoever was not the one
 * may read the e-mail only days later. It only takes access away, so it gives nobody anything.
 */
const SECURE_ACCOUNT_DAYS = 7;
/** E-mails of one kind to one account while one still works, whoever asks and from wherever. */
const MAX_TOKENS_PER_HOUR = 3;
const PRIVACY_NOTICE = 'PRIVACY_NOTICE';

export interface Registration {
  readonly email: string;
  readonly password: string;
  readonly locale: string;
  readonly privacyNoticeVersion: string;
}

export interface Account {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly locale: string;
  /** A sign-in needs the code of an authenticator app (A04). */
  readonly mfaEnabled: boolean;
}

function assertNotBreached(password: string): void {
  if (!isBreachedPassword(password)) return;
  throw new DomainException('VALIDATION_FAILED', {
    fieldErrors: [
      {
        field: 'password',
        code: 'PASSWORD_BREACHED',
        message: FIELD_ERROR_MESSAGES.PASSWORD_BREACHED,
      },
    ],
  });
}

/**
 * Sign-up, confirming an address and a new password (ADR 0004 §8). What is answered never says
 * whether an address has an account: the same status and body. The work differs by the writes of a
 * known address, which OPS01 closes together with the limits at scale. An e-mail is queued in the
 * transaction of its reason, so neither exists without the other.
 */
@Injectable()
export class AccountService {
  constructor(
    @InjectTransactionHost('platform') private readonly txHost: PlatformTransactionHost,
    private readonly clock: Clock,
    private readonly secrets: AuthSecrets,
    private readonly notifications: AccountNotifications,
    private readonly audit: PlatformAudit,
    private readonly attempts: SignInAttempts,
    private readonly devices: KnownDevices,
  ) {}

  /** Creates the account only, in the platform: a patient profile belongs to a practice (B01). */
  async register({ email, password, locale, privacyNoticeVersion }: Registration): Promise<void> {
    assertNotBreached(password);
    const passwordHash = await hashPassword(password);
    await this.txHost.withTransaction(async () => {
      const db = this.txHost.tx;
      const { count } = await db.user.createMany({
        // Its age decides when an account nobody confirmed goes, so it comes from this clock.
        data: [{ email, passwordHash, locale, createdAt: dbInstantOf(this.clock.now()) }],
        skipDuplicates: true,
      });
      if (count === 0) return;
      const { id } = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
      await db.accountConsent.create({
        data: {
          userId: id,
          type: PRIVACY_NOTICE,
          textVersion: privacyNoticeVersion,
          givenAt: dbInstantOf(this.clock.now()),
        },
      });
      await this.issueToken(id, 'EMAIL_VERIFICATION', 'EMAIL_VERIFICATION');
      await this.audit.record({
        actor: auditActorOf(id),
        action: 'auth.register',
        outcome: 'SUCCEEDED',
      });
    });
  }

  /**
   * Confirms an address, with the password of the account. Whoever holds the mailbox must also be
   * who signed up: otherwise a click on a link nobody asked for would make a stranger's password
   * valid for that address, and a mistyped address would hand over what the account holds.
   *
   * The link is judged first: an old e-mail must not become a way to test passwords. Then the
   * password is counted like one at a sign-in, so this route is no way around the wait.
   */
  async verifyEmail(token: string, password: string): Promise<void> {
    const row = await this.txHost.tx.accountToken.findUnique({
      where: { tokenHash: sha256(token) },
      select: { purpose: true, usedAt: true, expiresAt: true, user: { select: { email: true } } },
    });
    if (
      row?.purpose !== 'EMAIL_VERIFICATION' ||
      row.usedAt !== null ||
      Temporal.Instant.compare(instantOf(row.expiresAt), this.clock.now()) <= 0
    ) {
      throw new DomainException('INVALID_TOKEN');
    }
    const attempt = await this.attempts.count(row.user.email);
    if (
      attempt === undefined ||
      attempt.waiting ||
      !(await verifyPassword(attempt.passwordHash, password))
    ) {
      await this.audit.record({
        actor: attempt === undefined ? ANONYMOUS_ACTOR : auditActorOf(attempt.userId),
        action: 'auth.email.verify',
        outcome: 'FAILED',
        errorCode: 'INVALID_CREDENTIALS',
      });
      throw new DomainException('INVALID_CREDENTIALS');
    }
    await this.txHost.withTransaction(async () => {
      const userId = await this.consumeToken(token, 'EMAIL_VERIFICATION');
      await this.txHost.tx.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: dbInstantOf(this.clock.now()), ...NO_FAILURES },
      });
      await this.audit.record({
        actor: auditActorOf(userId),
        action: 'auth.email.verify',
        outcome: 'SUCCEEDED',
      });
    });
  }

  /** A token lasts 30 minutes, so this is how an account that missed them gets another. */
  async resendVerification(email: string): Promise<void> {
    await this.txHost.withTransaction(async () => {
      const user = await this.txHost.tx.user.findUnique({
        where: { email },
        select: { id: true, emailVerifiedAt: true },
      });
      // No account, or one that is confirmed already: nothing to send, and the same answer.
      if (user?.emailVerifiedAt !== null) return;
      await this.issueToken(user.id, 'EMAIL_VERIFICATION', 'EMAIL_VERIFICATION');
    });
  }

  async forgotPassword(email: string): Promise<void> {
    await this.txHost.withTransaction(async () => {
      const user = await this.txHost.tx.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (user === null) return;
      await this.issueToken(user.id, 'PASSWORD_RESET', 'PASSWORD_RESET');
    });
  }

  /**
   * A new password ends every session and every other link to choose one: whoever else was in is
   * out. Its link reached the mailbox, so it also confirms the address. That is the way back for an
   * owner whose address someone else signed up with, and so an account never confirmed starts anew:
   * what it holds was entered by someone who never showed this mailbox, and may be someone else's.
   */
  async resetPassword(token: string, password: string): Promise<void> {
    assertNotBreached(password);
    const passwordHash = await hashPassword(password);
    await this.txHost.withTransaction(async () => {
      const db = this.txHost.tx;
      const now = dbInstantOf(this.clock.now());
      const userId = await this.consumeToken(token, 'PASSWORD_RESET');
      const account = await db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, locale: true, emailVerifiedAt: true },
      });
      if (account.emailVerifiedAt === null) {
        // The foreign keys take the details, consents, tokens and sessions along.
        await db.user.delete({ where: { id: userId } });
        const { id } = await db.user.create({
          data: {
            email: account.email,
            locale: account.locale,
            passwordHash,
            emailVerifiedAt: now,
            createdAt: now,
          },
          select: { id: true },
        });
        await this.audit.record({
          actor: auditActorOf(id),
          action: 'auth.password.reset',
          outcome: 'SUCCEEDED',
        });
        return;
      }
      await db.user.update({ where: { id: userId }, data: { passwordHash, ...NO_FAILURES } });
      await this.devices.clearFailures(userId);
      await db.accountToken.updateMany({
        where: { userId, purpose: 'PASSWORD_RESET', usedAt: null },
        data: { usedAt: now },
      });
      await db.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      // BR-21: a new password is told to the mailbox, with the way back if it was not its owner.
      await this.issueToken(userId, 'SECURE_ACCOUNT', 'PASSWORD_CHANGED');
      await this.audit.record({
        actor: auditActorOf(userId),
        action: 'auth.password.reset',
        outcome: 'SUCCEEDED',
      });
    });
  }

  /**
   * "This was not me" (E10, ADR 0004 §8): with the link of a security e-mail, every session of the
   * account ends, its password stops working, its browsers become strangers, and a link to choose a
   * new password goes to the mailbox. Whoever signed in with a stolen password is out and stays out.
   * The second factor stays: an older link with the mailbox must not take away the one the owner
   * set up; one that an intruder set up only practice management or the operator removes (RT-96, D17).
   */
  async secureAccount(token: string): Promise<void> {
    const unusable = await hashPassword(randomBytes(32).toString('base64url'));
    await this.txHost.withTransaction(async () => {
      const db = this.txHost.tx;
      const now = dbInstantOf(this.clock.now());
      const userId = await this.consumeToken(token, 'SECURE_ACCOUNT');
      await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await db.user.update({
        where: { id: userId },
        data: { passwordHash: unusable, ...NO_FAILURES },
      });
      await db.accountToken.updateMany({
        where: { userId, purpose: 'SECURE_ACCOUNT', usedAt: null },
        data: { usedAt: now },
      });
      await this.devices.forget(userId);
      await this.issueToken(userId, 'PASSWORD_RESET', 'PASSWORD_RESET');
      await this.audit.record({
        actor: auditActorOf(userId),
        action: 'auth.account.secure',
        outcome: 'SUCCEEDED',
      });
    });
  }

  /**
   * E10, in the transaction of a sign-in that is not the account's first, from a browser it does not
   * know or from the app. Only to a confirmed address: an unconfirmed one may belong to someone else,
   * who would learn of sign-ins.
   */
  async noticeNewSignIn(userId: string, sessionId: string): Promise<void> {
    if (!(await this.isConfirmed(userId))) return;
    await this.issueToken(userId, 'SECURE_ACCOUNT', 'NEW_SIGN_IN', sessionId);
  }

  /**
   * BR-21, in the transaction that put an authenticator app in force: whoever had only the password
   * could have set it up, and the owner would then need its codes. Only to a confirmed address.
   */
  async noticeSecondFactor(userId: string): Promise<void> {
    if (!(await this.isConfirmed(userId))) return;
    await this.issueToken(userId, 'SECURE_ACCOUNT', 'SECOND_FACTOR_ENABLED');
  }

  private async isConfirmed(userId: string): Promise<boolean> {
    const user = await this.txHost.tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    return user.emailVerifiedAt !== null;
  }

  /**
   * For who mistyped an address: an account nobody confirmed goes at once, with its details. Anything
   * else is the deletion with its export and its practices (PR01).
   */
  async deleteUnconfirmed(userId: string): Promise<void> {
    await this.txHost.withTransaction(async () => {
      const { count } = await this.txHost.tx.user.deleteMany({
        where: { id: userId, emailVerifiedAt: null },
      });
      if (count === 0) throw new DomainException('CONFLICT');
      await this.audit.record({
        actor: auditActorOf(userId),
        action: 'auth.account.delete-unconfirmed',
        outcome: 'SUCCEEDED',
      });
    });
  }

  async accountOf(userId: string): Promise<Account> {
    const user = await this.txHost.tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, emailVerifiedAt: true, locale: true, totpEnabledAt: true },
    });
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      locale: user.locale,
      mfaEnabled: user.totpEnabledAt !== null,
    };
  }

  async changeLocale(userId: string, locale: string): Promise<Account> {
    await this.txHost.tx.user.update({ where: { id: userId }, data: { locale } });
    return this.accountOf(userId);
  }

  private async issueToken(
    userId: string,
    purpose: AccountTokenPurpose,
    template: AccountNotificationTemplate,
    sessionId?: string,
  ): Promise<void> {
    const db = this.txHost.tx;
    const now = this.clock.now();
    const expiresAt =
      purpose === 'SECURE_ACCOUNT'
        ? now.add({ hours: SECURE_ACCOUNT_DAYS * 24 })
        : now.add({ minutes: ACCOUNT_TOKEN_MINUTES });
    // The lock of the account's row: requests at the same moment must count each other.
    await db.$queryRaw`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    // By their expiry, which comes from the clock of this process: created within the last hour.
    const recent = await db.accountToken.count({
      where: { userId, purpose, expiresAt: { gt: dbInstantOf(expiresAt.subtract({ hours: 1 })) } },
    });
    const working = await db.accountToken.count({
      where: { userId, purpose, usedAt: null, expiresAt: { gt: dbInstantOf(now) } },
    });
    // A stranger can use up the limit, so whoever has no working link can always get one.
    if (recent >= MAX_TOKENS_PER_HOUR && working > 0) return;
    const id = randomUUID();
    await db.accountToken.create({
      data: {
        id,
        userId,
        purpose,
        tokenHash: sha256(await this.secrets.accountTokenOf(id)),
        expiresAt: dbInstantOf(expiresAt),
      },
    });
    await this.notifications.enqueue({
      userId,
      template,
      accountTokenId: id,
      dedupeKey: `account-token:${id}`,
      ...(sessionId === undefined ? {} : { sessionId }),
    });
  }

  /** Whose token it is, once only. The update asks again, so two requests cannot both use it. */
  private async consumeToken(token: string, purpose: AccountTokenPurpose): Promise<string> {
    const now = dbInstantOf(this.clock.now());
    const db = this.txHost.tx;
    const row = await db.accountToken.findUnique({
      where: { tokenHash: sha256(token) },
      select: { id: true, userId: true, purpose: true },
    });
    if (row?.purpose !== purpose) throw new DomainException('INVALID_TOKEN');
    // The account's row before the token's, as a deletion takes them: a confirmation, a reset or
    // securing the account and a deletion lock in one order (the review of the profile).
    await db.$queryRaw`SELECT 1 FROM users WHERE id = ${row.userId}::uuid FOR UPDATE`;
    const { count } = await db.accountToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count !== 1) throw new DomainException('INVALID_TOKEN');
    return row.userId;
  }
}

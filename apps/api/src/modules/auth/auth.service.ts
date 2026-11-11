import { randomBytes, randomUUID } from 'node:crypto';
import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { PlatformTransactionHost } from '../../common/database/platform-transactional.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { Actor } from '../../common/security/actor.js';
import { AuthSecrets, sameSecret, sha256 } from '../../common/security/auth-secrets.js';
import {
  ANONYMOUS_ACTOR,
  auditActorOf,
  PlatformAudit,
} from '../../common/security/platform-audit.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf, instantOf } from '../../common/time/convert.js';
import { ACCESS_TOKEN_SECONDS, AccessTokens } from './access-tokens.js';
import { refreshDecision } from './domain/auth.rules.js';
import { hashPassword, verifyPassword } from './domain/password.js';
import {
  AMR_ONE_TIME_CODE,
  AMR_PASSWORD,
  SecondFactor,
  type SecondFactorInput,
  type TotpSetup,
} from './second-factor.js';
import type { SessionCookieValues } from './session-cookies.js';
import { SignInAttempts } from './sign-in-attempts.js';

const REFRESH_TOKEN_BYTES = 32;
const REFRESH_TOKEN_DAYS = 30;

/** The answer that puts a second factor in force: the recovery codes, shown once, and the session. */
export interface EnabledSecondFactor {
  readonly recoveryCodes: readonly string[];
  readonly session: IssuedSession;
}

export interface IssuedSession extends SessionCookieValues {
  readonly userId: string;
}

/** Who signs in with an unknown address waits as long as who knows one: the same work is done. */
const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(REFRESH_TOKEN_BYTES).toString('base64url'));

/**
 * Sign-in, refresh and sign-out (ADR 0004). Every failure of a sign-in looks the same, whether the
 * address is unknown, the password wrong or the account waiting after too many failures. An address
 * need not be confirmed to sign in, only to book (BR-09), which leaves RT-89: signing up and then
 * signing in tells whether an address has an account.
 */
@Injectable()
export class AuthService {
  constructor(
    @InjectTransactionHost('platform') private readonly txHost: PlatformTransactionHost,
    private readonly clock: Clock,
    private readonly tokens: AccessTokens,
    private readonly secrets: AuthSecrets,
    private readonly audit: PlatformAudit,
    private readonly attempts: SignInAttempts,
    private readonly secondFactor: SecondFactor,
  ) {}

  /**
   * An account with a second factor needs its code too (ADR 0004 §7), so a stolen password alone
   * opens no session. Every request counts as an attempt until one succeeds: a password without its
   * code and a wrong code count like a wrong password, so codes cannot be guessed past the wait.
   */
  async login(email: string, password: string, factor?: SecondFactorInput): Promise<IssuedSession> {
    const attempt = await this.attempts.count(email);
    const hash = attempt?.passwordHash ?? (await DUMMY_PASSWORD_HASH);
    const matches = await verifyPassword(hash, password);
    if (attempt === undefined || attempt.waiting || !matches) {
      return this.failedLogin(attempt?.userId, 'INVALID_CREDENTIALS');
    }
    const { userId, passwordHash } = attempt;
    const prepared = await this.secondFactor.prepare(userId, factor);
    const outcome = await this.txHost.withTransaction(async () => {
      // Asks for the password that was checked: a reset in the meantime ended every session, so
      // this one must not start after it.
      const verdict = await this.secondFactor.verify(userId, passwordHash, prepared);
      if ('failed' in verdict) return verdict;
      await this.txHost.tx.user.update({
        where: { id: userId },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      const actor = auditActorOf(userId);
      if (verdict.usedRecoveryCode) {
        await this.audit.record({ actor, action: 'auth.mfa.recovery', outcome: 'SUCCEEDED' });
      }
      await this.audit.record({ actor, action: 'auth.login', outcome: 'SUCCEEDED' });
      return { session: await this.issue(userId, randomUUID(), verdict.amr) };
    });
    if ('failed' in outcome) return this.failedLogin(userId, outcome.failed);
    return outcome.session;
  }

  /** Starts setting up the authenticator app of the caller's own account. */
  async startTotp(actor: Actor): Promise<TotpSetup> {
    const setup = await this.secondFactor.start(actor.userId);
    await this.audit.record({
      actor: auditActorOf(actor.userId),
      action: 'auth.mfa.start',
      outcome: 'SUCCEEDED',
    });
    return setup;
  }

  /**
   * Puts the second factor in force with a first code. The person just proved both factors, so
   * this sign-in counts with both from now on: its session is replaced like at a refresh, in the
   * same family, and every other sign-in of the account ends, because it has only the password.
   */
  async enableTotp(actor: Actor, code: string): Promise<EnabledSecondFactor> {
    const pending = await this.secondFactor.pendingSecretOf(actor.userId);
    const outcome =
      pending === undefined
        ? undefined
        : await this.txHost.withTransaction(async () => {
            if (!(await this.secondFactor.isStillPending(actor.userId, pending.sealed))) {
              return undefined;
            }
            const recoveryCodes = await this.secondFactor.enable(
              actor.userId,
              code,
              pending.secret,
            );
            if (recoveryCodes === undefined) return undefined;
            const session = await this.stepUp(actor);
            await this.audit.record({
              actor: auditActorOf(actor.userId),
              action: 'auth.mfa.enable',
              outcome: 'SUCCEEDED',
            });
            return { recoveryCodes, session };
          });
    if (outcome !== undefined) return outcome;
    await this.audit.record({
      actor: auditActorOf(actor.userId),
      action: 'auth.mfa.enable',
      outcome: 'FAILED',
      errorCode: 'MFA_CODE_INVALID',
    });
    throw new DomainException('MFA_CODE_INVALID');
  }

  /** Records a failed sign-in and answers it. */
  private async failedLogin(
    userId: string | undefined,
    code: 'INVALID_CREDENTIALS' | 'MFA_CODE_REQUIRED' | 'MFA_CODE_INVALID',
  ): Promise<never> {
    await this.audit.record({
      actor: userId === undefined ? ANONYMOUS_ACTOR : auditActorOf(userId),
      action: 'auth.login',
      outcome: 'FAILED',
      errorCode: code,
    });
    throw new DomainException(code);
  }

  /** In the caller's transaction, under the lock of the user's row. */
  private async stepUp(actor: Actor): Promise<IssuedSession> {
    const now = dbInstantOf(this.clock.now());
    const db = this.txHost.tx;
    const session = await db.session.findUnique({
      where: { id: actor.sessionId },
      select: { familyId: true },
    });
    const { count } = await db.session.updateMany({
      where: {
        id: actor.sessionId,
        userId: actor.userId,
        rotatedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { rotatedAt: now },
    });
    if (session === null || count !== 1) throw new DomainException('UNAUTHENTICATED');
    await db.session.updateMany({
      where: { userId: actor.userId, familyId: { not: session.familyId }, revokedAt: null },
      data: { revokedAt: now },
    });
    return this.issue(actor.userId, session.familyId, [AMR_PASSWORD, AMR_ONE_TIME_CODE]);
  }

  /**
   * Replaces a refresh token by a new one. Only one request can do that: the update below asks for
   * a token that is still not rotated. An old token used again means that someone else has it, so
   * its whole family ends (ADR 0004 §5).
   */
  async refresh(refreshToken: string, csrfToken: string | undefined): Promise<IssuedSession> {
    const session = await this.txHost.tx.session.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (session === null) throw new DomainException('UNAUTHENTICATED');
    if (csrfToken !== undefined) await this.assertCsrf(session.id, csrfToken);
    const now = this.clock.now();
    const decision = refreshDecision(
      {
        expiresAt: instantOf(session.expiresAt),
        rotatedAt: session.rotatedAt === null ? null : instantOf(session.rotatedAt),
        revokedAt: session.revokedAt === null ? null : instantOf(session.revokedAt),
        createdAt: instantOf(session.createdAt),
        secondFactor: session.amr.includes(AMR_ONE_TIME_CODE),
      },
      now,
    );
    if (decision === 'REUSE') {
      await this.revokeFamily(session.familyId, session.userId, 'auth.refresh.reuse', 'FAILED');
    }
    if (decision === 'IDLE') {
      // The front desk's computer was left: the whole sign-in ends, not only this token.
      await this.revokeFamily(session.familyId, session.userId, 'auth.session.idle', 'SUCCEEDED');
    }
    if (decision !== 'ROTATE') throw new DomainException('UNAUTHENTICATED');
    return this.txHost.withTransaction(async () => {
      await this.lockSessionsOf(session.userId);
      const { count } = await this.txHost.tx.session.updateMany({
        where: { id: session.id, rotatedAt: null, revokedAt: null },
        data: { rotatedAt: dbInstantOf(now) },
      });
      if (count !== 1) throw new DomainException('UNAUTHENTICATED');
      return this.issue(session.userId, session.familyId, session.amr);
    });
  }

  /** Ends the sign-in of a refresh token, with all that was rotated from it. Idempotent. */
  async logout(refreshToken: string, csrfToken: string | undefined): Promise<void> {
    const session = await this.txHost.tx.session.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      select: { id: true, familyId: true, userId: true },
    });
    if (session === null) return;
    if (csrfToken !== undefined) await this.assertCsrf(session.id, csrfToken);
    await this.revokeFamily(session.familyId, session.userId, 'auth.logout', 'SUCCEEDED');
  }

  /** For a cookie request: the header must be the one this session's page could read. */
  async assertCsrf(sessionId: string, csrfToken: string): Promise<void> {
    if (!sameSecret(csrfToken, await this.secrets.csrfTokenOf(sessionId))) {
      throw new ForbiddenException();
    }
  }

  private async revokeFamily(
    familyId: string,
    userId: string,
    action: string,
    outcome: 'SUCCEEDED' | 'FAILED',
  ): Promise<void> {
    await this.txHost.withTransaction(async () => {
      await this.lockSessionsOf(userId);
      await this.txHost.tx.session.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: dbInstantOf(this.clock.now()) },
      });
      await this.audit.record({ actor: auditActorOf(userId), action, outcome });
    });
  }

  /**
   * Whoever ends or replaces a person's sessions waits here for the others. An update sees only what
   * was committed when it began, so a sign-out would otherwise miss the session a refresh is making at
   * that moment, and that session would live on. A sign-in and a new password wait at the same row,
   * through their updates of it.
   */
  private async lockSessionsOf(userId: string): Promise<void> {
    await this.txHost.tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  }

  private async issue(
    userId: string,
    familyId: string,
    amr: readonly string[],
  ): Promise<IssuedSession> {
    const sessionId = randomUUID();
    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const refreshSeconds = REFRESH_TOKEN_DAYS * 86_400;
    // By the API's clock, not the database's: the idle rule of a refresh reads it against that clock.
    const now = this.clock.now();
    await this.txHost.tx.session.create({
      data: {
        id: sessionId,
        userId,
        familyId,
        tokenHash: sha256(refreshToken),
        amr: [...amr],
        createdAt: dbInstantOf(now),
        expiresAt: dbInstantOf(now.add({ seconds: refreshSeconds })),
      },
    });
    return {
      userId,
      accessToken: await this.tokens.issue({ userId, sessionId, amr }),
      accessSeconds: ACCESS_TOKEN_SECONDS,
      refreshToken,
      refreshSeconds,
      csrfToken: await this.secrets.csrfTokenOf(sessionId),
    };
  }
}

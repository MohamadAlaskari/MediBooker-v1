import { randomBytes, randomUUID } from 'node:crypto';
import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { PlatformTransactionHost } from '../../common/database/platform-transactional.js';
import { DomainException } from '../../common/errors/domain.exception.js';
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
import type { SessionCookieValues } from './session-cookies.js';
import { SignInAttempts } from './sign-in-attempts.js';

const REFRESH_TOKEN_BYTES = 32;
const REFRESH_TOKEN_DAYS = 30;
/** Password sign-in; A04 adds the second factor. */
const AMR_PASSWORD = 'pwd';

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
  ) {}

  async login(email: string, password: string): Promise<IssuedSession> {
    const attempt = await this.attempts.count(email);
    const hash = attempt?.passwordHash ?? (await DUMMY_PASSWORD_HASH);
    const matches = await verifyPassword(hash, password);
    if (attempt === undefined || attempt.waiting || !matches) {
      await this.audit.record({
        actor: attempt === undefined ? ANONYMOUS_ACTOR : auditActorOf(attempt.userId),
        action: 'auth.login',
        outcome: 'FAILED',
        errorCode: 'INVALID_CREDENTIALS',
      });
      throw new DomainException('INVALID_CREDENTIALS');
    }
    return this.txHost.withTransaction(async () => {
      // Asks for the password that was checked: a reset in the meantime ended every session, so
      // this one must not start after it.
      const { count } = await this.txHost.tx.user.updateMany({
        where: { id: attempt.userId, passwordHash: attempt.passwordHash },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      if (count !== 1) throw new DomainException('INVALID_CREDENTIALS');
      await this.audit.record({
        actor: auditActorOf(attempt.userId),
        action: 'auth.login',
        outcome: 'SUCCEEDED',
      });
      return this.issue(attempt.userId, randomUUID(), [AMR_PASSWORD]);
    });
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
      },
      now,
    );
    if (decision === 'REUSE') {
      await this.revokeFamily(session.familyId, session.userId, 'auth.refresh.reuse', 'FAILED');
    }
    if (decision !== 'ROTATE') throw new DomainException('UNAUTHENTICATED');
    return this.txHost.withTransaction(async () => {
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
      await this.txHost.tx.session.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: dbInstantOf(this.clock.now()) },
      });
      await this.audit.record({ actor: auditActorOf(userId), action, outcome });
    });
  }

  private async issue(
    userId: string,
    familyId: string,
    amr: readonly string[],
  ): Promise<IssuedSession> {
    const sessionId = randomUUID();
    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const refreshSeconds = REFRESH_TOKEN_DAYS * 86_400;
    await this.txHost.tx.session.create({
      data: {
        id: sessionId,
        userId,
        familyId,
        tokenHash: sha256(refreshToken),
        amr: [...amr],
        expiresAt: dbInstantOf(this.clock.now().add({ seconds: refreshSeconds })),
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

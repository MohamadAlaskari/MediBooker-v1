import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { PlatformTransactionHost } from '../../common/database/platform-transactional.js';
import {
  type Actor,
  type AuthenticatableRequest,
  Authenticator,
} from '../../common/security/actor.js';
import { AuthSecrets, sameSecret } from '../../common/security/auth-secrets.js';
import { Clock } from '../../common/time/clock.js';
import { instantOf } from '../../common/time/convert.js';
import { AccessTokens } from './access-tokens.js';
import {
  ACCESS_COOKIE,
  bearerTokenOf,
  cookiesOf,
  CSRF_HEADER,
  headerOf,
} from './session-cookies.js';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A request's actor: the token from `Authorization: Bearer` (the app) or the cookie (the web), and
 * the session row on every request, so a sign-out or a revocation takes effect at once. A cookie
 * comes along by itself, so what changes something also needs the CSRF header (ADR 0004 §6).
 */
@Injectable()
export class SessionAuthenticator extends Authenticator {
  constructor(
    @InjectTransactionHost('platform') private readonly txHost: PlatformTransactionHost,
    private readonly tokens: AccessTokens,
    private readonly secrets: AuthSecrets,
    private readonly clock: Clock,
  ) {
    super();
  }

  async authenticate({ method, headers }: AuthenticatableRequest): Promise<Actor | undefined> {
    const bearer = bearerTokenOf(headers.authorization);
    const token = bearer ?? cookiesOf(headers.cookie).get(ACCESS_COOKIE);
    if (token === undefined) return undefined;
    const claims = await this.tokens.verify(token);
    if (claims === undefined) return undefined;
    const session = await this.txHost.tx.session.findUnique({
      where: { id: claims.sessionId },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    const live =
      session !== null &&
      session.userId === claims.userId &&
      session.revokedAt === null &&
      Temporal.Instant.compare(instantOf(session.expiresAt), this.clock.now()) > 0;
    if (!live) return undefined;
    if (bearer === undefined && !SAFE_METHODS.has(method ?? '')) {
      const header = headerOf(headers[CSRF_HEADER]);
      const expected = await this.secrets.csrfTokenOf(claims.sessionId);
      if (header === undefined || !sameSecret(header, expected)) throw new ForbiddenException();
    }
    return claims;
  }
}

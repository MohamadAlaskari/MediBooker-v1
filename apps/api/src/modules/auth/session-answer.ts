import type { ServerResponse } from 'node:http';
import type { AccountService } from './account.service.js';
import type { SessionDto } from './auth.dto.js';
import type { IssuedSession } from './auth.service.js';
import { setSessionCookies } from './session-cookies.js';

/** A new session as its client takes it: a browser in cookies, the app in the answer (ADR 0004 §6). */
export async function sessionAnswer(
  accounts: AccountService,
  session: IssuedSession,
  delivery: 'cookie' | 'body',
  response: ServerResponse,
): Promise<SessionDto> {
  const account = await accounts.accountOf(session.userId);
  if (delivery === 'cookie') {
    setSessionCookies(response, session);
    return { account };
  }
  return {
    account,
    tokens: {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresInSeconds: session.accessSeconds,
    },
  };
}

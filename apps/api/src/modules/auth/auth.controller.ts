import type { IncomingMessage, ServerResponse } from 'node:http';
import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DomainException } from '../../common/errors/domain.exception.js';
import { Public } from '../../common/security/public.decorator.js';
import { AccountService } from './account.service.js';
import {
  ConfirmEmailDto,
  EmailDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  SessionDto,
} from './auth.dto.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import {
  clearSessionCookies,
  cookiesOf,
  CSRF_HEADER,
  headerOf,
  REFRESH_COOKIE,
  setSessionCookies,
} from './session-cookies.js';

/** Per route and address (ADR 0004 §8); an account also waits after failed sign-ins. */
const GUESSING_LIMIT = { default: { ttl: 60_000, limit: 10 } };
const MAIL_LIMIT = { default: { ttl: 60_000, limit: 5 } };
const REFRESH_LIMIT = { default: { ttl: 60_000, limit: 30 } };

/** The refresh token of a request: a browser's cookie, which also needs the CSRF header. */
interface PresentedRefreshToken {
  readonly refreshToken: string;
  readonly csrfToken: string | undefined;
}

function presentedRefreshToken(
  request: IncomingMessage,
  fromBody: string | undefined,
): PresentedRefreshToken | undefined {
  if (fromBody !== undefined) return { refreshToken: fromBody, csrfToken: undefined };
  const fromCookie = cookiesOf(request.headers.cookie).get(REFRESH_COOKIE);
  if (fromCookie === undefined) return undefined;
  // An empty header can match nothing, and that is the 403 a request without one must get.
  return { refreshToken: fromCookie, csrfToken: headerOf(request.headers[CSRF_HEADER]) ?? '' };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accounts: AccountService,
  ) {}

  @Public() // ADR 0004: who has no account yet cannot sign in; the answer says nothing about one
  @Throttle(MAIL_LIMIT)
  @ApiOperation({ summary: 'Create an account; the answer is the same for a known address' })
  @HttpCode(202)
  @Post('register')
  async register(@Body() body: RegisterDto): Promise<void> {
    await this.accounts.register(body);
  }

  @Public() // ADR 0004: the token and the password in the body are the proof
  @Throttle(GUESSING_LIMIT)
  @ApiOperation({ summary: 'Confirm an e-mail address, with the password of the account' })
  @HttpCode(204)
  @Post('verify-email')
  async verifyEmail(@Body() { token, password }: ConfirmEmailDto): Promise<void> {
    await this.accounts.verifyEmail(token, password);
  }

  @Public() // ADR 0004: the answer is the same for a known address
  @Throttle(MAIL_LIMIT)
  @ApiOperation({ summary: 'Send the confirmation e-mail again' })
  @HttpCode(202)
  @Post('verify-email/resend')
  async resendVerification(@Body() { email }: EmailDto): Promise<void> {
    await this.accounts.resendVerification(email);
  }

  @Public() // ADR 0004: the password in the body is the proof
  @Throttle(GUESSING_LIMIT)
  @ApiOperation({ summary: 'Sign in' })
  @ApiOkResponse({ type: SessionDto })
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() { email, password, delivery }: LoginDto,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<SessionDto> {
    const session = await this.auth.login(email, password);
    return this.answer(session, delivery ?? 'cookie', response);
  }

  @Public() // ADR 0004: the refresh token is the proof, because the access token may be over
  @Throttle(REFRESH_LIMIT)
  @ApiOperation({ summary: 'Replace a refresh token by a new one' })
  @ApiOkResponse({ type: SessionDto })
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Body() { refreshToken }: RefreshDto,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<SessionDto> {
    const presented = presentedRefreshToken(request, refreshToken);
    if (presented === undefined) throw new DomainException('UNAUTHENTICATED');
    const session = await this.auth.refresh(presented.refreshToken, presented.csrfToken);
    return this.answer(session, refreshToken === undefined ? 'cookie' : 'body', response);
  }

  @Public() // ADR 0004: must work after the access token is over, so it reads the refresh token
  @Throttle(REFRESH_LIMIT)
  @ApiOperation({ summary: 'Sign out: ends this sign-in' })
  @HttpCode(204)
  @Post('logout')
  async logout(
    @Body() { refreshToken }: RefreshDto,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    const presented = presentedRefreshToken(request, refreshToken);
    if (presented === undefined) return;
    await this.auth.logout(presented.refreshToken, presented.csrfToken);
    // Only after that: a request of another site has no cookie, and must clear none.
    clearSessionCookies(response);
  }

  @Public() // ADR 0004: who forgot a password cannot sign in; same answer for a known address
  @Throttle(MAIL_LIMIT)
  @ApiOperation({ summary: 'Send an e-mail to choose a new password' })
  @HttpCode(202)
  @Post('password/forgot')
  async forgotPassword(@Body() { email }: EmailDto): Promise<void> {
    await this.accounts.forgotPassword(email);
  }

  @Public() // ADR 0004: the token in the body is the proof
  @Throttle(GUESSING_LIMIT)
  @ApiOperation({ summary: 'Choose a new password; ends every session' })
  @HttpCode(204)
  @Post('password/reset')
  async resetPassword(@Body() { token, password }: ResetPasswordDto): Promise<void> {
    await this.accounts.resetPassword(token, password);
  }

  private async answer(
    session: IssuedSession,
    delivery: 'cookie' | 'body',
    response: ServerResponse,
  ): Promise<SessionDto> {
    const account = await this.accounts.accountOf(session.userId);
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
}

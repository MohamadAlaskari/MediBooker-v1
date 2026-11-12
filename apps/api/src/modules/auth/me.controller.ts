import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { isUuid } from '../../common/context/request-id.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { Actor } from '../../common/security/actor.js';
import { CurrentUser } from '../../common/security/current-user.decorator.js';
import { AccountService } from './account.service.js';
import { GUESSING_LIMIT } from './auth.controller.js';
import {
  AccountDto,
  ConfirmTotpDto,
  SignInDto,
  TotpEnabledDto,
  TotpSetupDto,
  UpdateAccountDto,
} from './auth.dto.js';
import { AuthService } from './auth.service.js';
import { sessionAnswer } from './session-answer.js';
import { ACCESS_COOKIE, bearerTokenOf, clearSessionCookies } from './session-cookies.js';

/** The caller's own account: who that is comes from the verified token only. */
@ApiTags('me')
@ApiBearerAuth()
@ApiCookieAuth(ACCESS_COOKIE)
@Controller('me')
export class MeController {
  constructor(
    private readonly accounts: AccountService,
    private readonly auth: AuthService,
  ) {}

  @ApiOperation({ summary: 'The own account' })
  @ApiOkResponse({ type: AccountDto })
  @Get()
  async getMe(@CurrentUser() actor: Actor): Promise<AccountDto> {
    return this.accounts.accountOf(actor.userId);
  }

  @ApiOperation({ summary: 'Change the language of e-mails' })
  @ApiOkResponse({ type: AccountDto })
  @Patch()
  async updateMe(
    @CurrentUser() actor: Actor,
    @Body() { locale }: UpdateAccountDto,
  ): Promise<AccountDto> {
    return this.accounts.changeLocale(actor.userId, locale);
  }

  @ApiOperation({
    summary: 'Start setting up an authenticator app: its secret, also as the text of a QR code',
  })
  @ApiOkResponse({ type: TotpSetupDto })
  @Throttle(GUESSING_LIMIT)
  @HttpCode(200)
  @Post('mfa/totp')
  async startTotp(@CurrentUser() actor: Actor): Promise<TotpSetupDto> {
    return this.auth.startTotp(actor);
  }

  @ApiOperation({
    summary:
      'Put the authenticator app in force with a first code; answers the recovery codes once',
  })
  @ApiOkResponse({ type: TotpEnabledDto })
  @Throttle(GUESSING_LIMIT)
  @HttpCode(200)
  @Post('mfa/totp/confirm')
  async confirmTotp(
    @CurrentUser() actor: Actor,
    @Body() { code }: ConfirmTotpDto,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<TotpEnabledDto> {
    const { recoveryCodes, session } = await this.auth.enableTotp(actor, code);
    // As the caller signed in, which the authenticator decides the same way: the app gets tokens
    // and a browser cookies, so a script that can send the CSRF header never sees a refresh token.
    const delivery = bearerTokenOf(request.headers.authorization) === undefined ? 'cookie' : 'body';
    const { account, tokens } = await sessionAnswer(this.accounts, session, delivery, response);
    return {
      account,
      ...(tokens === undefined ? {} : { tokens }),
      recoveryCodes: [...recoveryCodes],
    };
  }

  @ApiOperation({ summary: 'The sign-ins of the own account that still work, newest first (A04)' })
  @ApiOkResponse({ type: [SignInDto] })
  @Get('sessions')
  async getSessions(@CurrentUser() actor: Actor): Promise<SignInDto[]> {
    const signIns = await this.auth.signInsOf(actor);
    return signIns.map((signIn) => ({
      ...signIn,
      signedInAt: signIn.signedInAt.toString(),
      lastActiveAt: signIn.lastActiveAt.toString(),
    }));
  }

  @ApiOperation({ summary: 'End one sign-in of the own account, for example on a lost phone' })
  @HttpCode(204)
  @Delete('sessions/:sessionId')
  async endSession(
    @CurrentUser() actor: Actor,
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    if (!isUuid(sessionId)) throw new DomainException('NOT_FOUND');
    await this.auth.endSignIn(actor, sessionId);
  }

  @ApiOperation({ summary: 'End every sign-in of the own account but this one' })
  @HttpCode(204)
  @Post('sessions/revoke-others')
  async endOtherSessions(@CurrentUser() actor: Actor): Promise<void> {
    await this.auth.endOtherSignIns(actor);
  }

  @ApiOperation({ summary: 'Delete an own account that was never confirmed: a mistyped address' })
  @HttpCode(204)
  @Delete('unconfirmed')
  async deleteUnconfirmedAccount(
    @CurrentUser() actor: Actor,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    await this.accounts.deleteUnconfirmed(actor.userId);
    clearSessionCookies(response);
  }
}

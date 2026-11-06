import type { ServerResponse } from 'node:http';
import { Body, Controller, Delete, Get, HttpCode, Patch, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Actor } from '../../common/security/actor.js';
import { CurrentUser } from '../../common/security/current-user.decorator.js';
import { AccountService } from './account.service.js';
import { AccountDto, UpdateAccountDto } from './auth.dto.js';
import { ACCESS_COOKIE, clearSessionCookies } from './session-cookies.js';

/** The caller's own account: who that is comes from the verified token only. */
@ApiTags('me')
@ApiBearerAuth()
@ApiCookieAuth(ACCESS_COOKIE)
@Controller('me')
export class MeController {
  constructor(private readonly accounts: AccountService) {}

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

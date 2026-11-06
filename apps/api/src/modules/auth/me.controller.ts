import { Body, Controller, Get, Patch } from '@nestjs/common';
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
import { ACCESS_COOKIE } from './session-cookies.js';

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
}

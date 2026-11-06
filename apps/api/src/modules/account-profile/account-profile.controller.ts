import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Actor } from '../../common/security/actor.js';
import { CurrentUser } from '../../common/security/current-user.decorator.js';
import { ProfileDto, UpdateProfileDto } from './account-profile.dto.js';
import { AccountProfileService } from './account-profile.service.js';

/** The caller's own details: who that is comes from the verified token only. */
@ApiTags('me')
@ApiBearerAuth()
@ApiCookieAuth('mb_access')
@Controller('me/profile')
export class AccountProfileController {
  constructor(private readonly profiles: AccountProfileService) {}

  @ApiOperation({ summary: 'The own details; 404 until they are entered' })
  @ApiOkResponse({ type: ProfileDto })
  @Get()
  async getProfile(@CurrentUser() actor: Actor): Promise<ProfileDto> {
    return this.profiles.profileOf(actor.userId);
  }

  @ApiOperation({ summary: 'Enter or change the own details and insurance' })
  @ApiOkResponse({ type: ProfileDto })
  @Put()
  async updateProfile(
    @CurrentUser() actor: Actor,
    @Body() input: UpdateProfileDto,
  ): Promise<ProfileDto> {
    return this.profiles.save(actor, input);
  }
}

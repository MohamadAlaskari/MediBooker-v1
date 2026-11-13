import { Body, Controller, Get, HttpCode, Ip, Param, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Actor } from '../../common/security/actor.js';
import { CurrentUser } from '../../common/security/current-user.decorator.js';
import { PracticeScoped } from '../../common/tenancy/practice-scoped.decorator.js';
import { ChangeTeamRoleDto, TeamDto, TeamMemberDto } from './team.dto.js';
import { Team } from './team.service.js';

/** Per route and address: a page of the team changes one member at a time. */
const TEAM_CHANGE_LIMIT = { default: { ttl: 60_000, limit: 30 } };

/**
 * The team page (W15, D17), for practice management only: the members with their base role,
 * practice management and doctor, and what management changes of them. Invitations follow with
 * M03 part 2.
 */
@ApiTags('team')
@ApiBearerAuth()
@ApiCookieAuth('mb_access')
@ApiParam({ name: 'practiceId', type: String, format: 'uuid' })
@Controller('practices/:practiceId/staff')
export class TeamController {
  constructor(private readonly team: Team) {}

  @PracticeScoped('id', { staff: 'management' })
  @ApiOperation({ summary: "The practice's team and its doctors; practice management only" })
  @ApiOkResponse({ type: TeamDto })
  @Get()
  async listTeam(@CurrentUser() actor: Actor): Promise<TeamDto> {
    return this.team.list(actor);
  }

  @Throttle(TEAM_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: 'management' })
  @ApiOperation({
    summary:
      'A base role, practice management and the doctor of a member; LAST_PRACTICE_MANAGER keeps the last one',
  })
  @ApiParam({ name: 'membershipId', format: 'uuid' })
  @ApiOkResponse({ type: TeamMemberDto })
  @Put(':membershipId/role')
  async changeTeamRole(
    @CurrentUser() actor: Actor,
    @Param('membershipId') membershipId: string,
    @Body() input: ChangeTeamRoleDto,
    @Ip() ip: string,
  ): Promise<TeamMemberDto> {
    return this.team.changeRole(actor, membershipId, input, ip);
  }

  @Throttle(TEAM_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: 'management' })
  @ApiOperation({
    summary: "Ends a member's access and every session of its account; not one's own",
  })
  @ApiParam({ name: 'membershipId', format: 'uuid' })
  @ApiOkResponse({ type: TeamMemberDto })
  @HttpCode(200)
  @Post(':membershipId/deactivate')
  async deactivateTeamMember(
    @CurrentUser() actor: Actor,
    @Param('membershipId') membershipId: string,
    @Ip() ip: string,
  ): Promise<TeamMemberDto> {
    return this.team.deactivate(actor, membershipId, ip);
  }

  @Throttle(TEAM_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: 'management' })
  @ApiOperation({ summary: 'Gives a deactivated member its access back' })
  @ApiParam({ name: 'membershipId', format: 'uuid' })
  @ApiOkResponse({ type: TeamMemberDto })
  @HttpCode(200)
  @Post(':membershipId/reactivate')
  async reactivateTeamMember(
    @CurrentUser() actor: Actor,
    @Param('membershipId') membershipId: string,
    @Ip() ip: string,
  ): Promise<TeamMemberDto> {
    return this.team.reactivate(actor, membershipId, ip);
  }

  @Throttle(TEAM_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: 'management' })
  @ApiOperation({
    summary:
      "Removes a member's lost authenticator app and ends its sessions; a new one at the next sign-in",
  })
  @ApiParam({ name: 'membershipId', format: 'uuid' })
  @ApiOkResponse({ type: TeamMemberDto })
  @HttpCode(200)
  @Post(':membershipId/second-factor/reset')
  async resetTeamSecondFactor(
    @CurrentUser() actor: Actor,
    @Param('membershipId') membershipId: string,
    @Ip() ip: string,
  ): Promise<TeamMemberDto> {
    return this.team.resetSecondFactor(actor, membershipId, ip);
  }
}

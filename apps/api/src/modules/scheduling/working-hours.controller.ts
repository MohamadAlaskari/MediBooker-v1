import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Actor } from '../../common/security/actor.js';
import { CurrentUser } from '../../common/security/current-user.decorator.js';
import { ALL_STAFF_ROLES, PracticeScoped } from '../../common/tenancy/practice-scoped.decorator.js';
import type { StaffRole } from '../../generated/practice/enums.js';
import {
  AbsenceCreatedDto,
  AbsenceInputDto,
  AbsenceListDto,
  ScheduleSlotDto,
  SlotChangeDto,
  SlotGenerationDto,
  WorkingHoursDto,
  WorkingHoursInputDto,
} from './working-hours.dto.js';
import { WorkingHours } from './working-hours.service.js';

/** Who makes every doctor's free times anew: the reception and the admin. */
const GENERATORS: readonly [StaffRole, ...StaffRole[]] = ['STAFF', 'ADMIN'];
/**
 * Per route, address and minute: what the team changes by hand, with room for a team that shares
 * one address. Each change also makes the free times anew, which reads the practice's rules.
 */
const SCHEDULE_CHANGE_LIMIT = { default: { limit: 30, ttl: 60_000 } };
const GENERATE_LIMIT = { default: { limit: 6, ttl: 60_000 } };

/**
 * The doctors' schedules (M04, W14): working hours, absences, the free times made from them, and a
 * time blocked or freed (BR-06, BR-07). The reception and the admin plan every doctor; a doctor
 * plans itself only (another doctor answers 404).
 */
@ApiTags('scheduling')
@ApiBearerAuth()
@ApiCookieAuth('mb_access')
@ApiParam({ name: 'practiceId', type: String, format: 'uuid' })
@Controller('practices/:practiceId')
export class WorkingHoursController {
  constructor(private readonly schedule: WorkingHours) {}

  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({ summary: "A doctor's week from today, with its free times" })
  @ApiParam({ name: 'providerId', format: 'uuid' })
  @ApiOkResponse({ type: WorkingHoursDto })
  @Get('providers/:providerId/working-hours')
  async getWorkingHours(@Param('providerId') providerId: string): Promise<WorkingHoursDto> {
    return this.schedule.week(providerId);
  }

  @Throttle(SCHEDULE_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({
    summary: "Replace a doctor's week from today; the free times follow at once",
  })
  @ApiParam({ name: 'providerId', format: 'uuid' })
  @ApiOkResponse({ type: WorkingHoursDto })
  @Put('providers/:providerId/working-hours')
  async replaceWorkingHours(
    @CurrentUser() actor: Actor,
    @Param('providerId') providerId: string,
    @Body() input: WorkingHoursInputDto,
    @Ip() ip: string,
  ): Promise<WorkingHoursDto> {
    return this.schedule.replaceWeek(actor, providerId, input, ip);
  }

  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({ summary: "A doctor's absences that are not over" })
  @ApiParam({ name: 'providerId', format: 'uuid' })
  @ApiOkResponse({ type: AbsenceListDto })
  @Get('providers/:providerId/absences')
  async listAbsences(@Param('providerId') providerId: string): Promise<AbsenceListDto> {
    return this.schedule.absences(providerId);
  }

  @Throttle(SCHEDULE_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({
    summary: 'Add an absence: its free times go, and its booked appointments are counted',
  })
  @ApiParam({ name: 'providerId', format: 'uuid' })
  @ApiCreatedResponse({ type: AbsenceCreatedDto })
  @Post('providers/:providerId/absences')
  async createAbsence(
    @CurrentUser() actor: Actor,
    @Param('providerId') providerId: string,
    @Body() input: AbsenceInputDto,
    @Ip() ip: string,
  ): Promise<AbsenceCreatedDto> {
    return this.schedule.addAbsence(actor, providerId, input, ip);
  }

  @Throttle(SCHEDULE_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({ summary: 'Remove an absence: its free times come back' })
  @ApiParam({ name: 'providerId', format: 'uuid' })
  @ApiParam({ name: 'absenceId', format: 'uuid' })
  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete('providers/:providerId/absences/:absenceId')
  async deleteAbsence(
    @CurrentUser() actor: Actor,
    @Param('providerId') providerId: string,
    @Param('absenceId') absenceId: string,
    @Ip() ip: string,
  ): Promise<void> {
    await this.schedule.removeAbsence(actor, providerId, absenceId, ip);
  }

  @Throttle(GENERATE_LIMIT)
  @PracticeScoped('id', { staff: GENERATORS })
  @ApiOperation({ summary: "Make every doctor's free times anew from the rules; idempotent" })
  @ApiCreatedResponse({ type: SlotGenerationDto })
  @Post('slots/generate')
  async generateSlots(@CurrentUser() actor: Actor, @Ip() ip: string): Promise<SlotGenerationDto> {
    return this.schedule.generate(actor, ip);
  }

  @Throttle(SCHEDULE_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({
    summary: 'Block a free time or free a blocked one; a booked one is SLOT_HAS_APPOINTMENT',
  })
  @ApiParam({ name: 'slotId', format: 'uuid' })
  @ApiOkResponse({ type: ScheduleSlotDto })
  @Patch('slots/:slotId')
  async updateSlot(
    @CurrentUser() actor: Actor,
    @Param('slotId') slotId: string,
    @Body() input: SlotChangeDto,
    @Ip() ip: string,
  ): Promise<ScheduleSlotDto> {
    return this.schedule.changeSlot(actor, slotId, input, ip);
  }
}

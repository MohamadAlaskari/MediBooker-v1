import { Body, Controller, Get, HttpCode, Ip, Param, Post, Query } from '@nestjs/common';
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
import { ALL_STAFF_ROLES, PracticeScoped } from '../../common/tenancy/practice-scoped.decorator.js';
import {
  CancelAsPracticeDto,
  DeskAppointmentDto,
  DeskAppointmentRowDto,
  DeskDayDto,
  DeskDayQueryDto,
} from './desk.dto.js';
import { DeskService } from './desk.service.js';

/**
 * Per address and minute. A reception checks in a waiting room at opening time, and the team of a
 * practice can share one address behind its router.
 */
const DESK_CHANGE_LIMIT = { default: { limit: 120, ttl: 60_000 } };

/**
 * The practice's side of its appointments (M05), for every role of its team with both factors
 * (A04). A path of its own: a person can be a patient of the practice and on its team, and the path
 * says in which of the two they act, never a guess of the API.
 */
@ApiTags('desk')
@ApiBearerAuth()
@ApiCookieAuth('mb_access')
@ApiParam({ name: 'practiceId', type: String, format: 'uuid' })
@Controller('practices/:practiceId/desk')
export class DeskController {
  constructor(private readonly desk: DeskService) {}

  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({
    summary: 'A day of the practice: its appointments, counts and what is left free',
  })
  @ApiOkResponse({ type: DeskDayDto })
  @Get('day')
  async getDeskDay(
    @CurrentUser() actor: Actor,
    @Query() query: DeskDayQueryDto,
    @Ip() ip: string,
  ): Promise<DeskDayDto> {
    return this.desk.day(actor, query, ip);
  }

  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({ summary: 'One appointment, with what the patient wrote; the read is audited' })
  @ApiParam({ name: 'appointmentId', format: 'uuid' })
  @ApiOkResponse({ type: DeskAppointmentDto })
  @Get('appointments/:appointmentId')
  async getDeskAppointment(
    @CurrentUser() actor: Actor,
    @Param('appointmentId') appointmentId: string,
    @Ip() ip: string,
  ): Promise<DeskAppointmentDto> {
    return this.desk.appointment(actor, appointmentId, ip);
  }

  @Throttle(DESK_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({ summary: "Check the patient in, on the appointment's day (BR-11)" })
  @ApiParam({ name: 'appointmentId', format: 'uuid' })
  @ApiOkResponse({ type: DeskAppointmentRowDto })
  @HttpCode(200)
  @Post('appointments/:appointmentId/check-in')
  async checkInAppointment(
    @CurrentUser() actor: Actor,
    @Param('appointmentId') appointmentId: string,
    @Ip() ip: string,
  ): Promise<DeskAppointmentRowDto> {
    return this.desk.change(actor, appointmentId, 'CHECK_IN', ip);
  }

  @Throttle(DESK_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({ summary: "Complete a checked-in visit, on the appointment's day (BR-11)" })
  @ApiParam({ name: 'appointmentId', format: 'uuid' })
  @ApiOkResponse({ type: DeskAppointmentRowDto })
  @HttpCode(200)
  @Post('appointments/:appointmentId/complete')
  async completeAppointment(
    @CurrentUser() actor: Actor,
    @Param('appointmentId') appointmentId: string,
    @Ip() ip: string,
  ): Promise<DeskAppointmentRowDto> {
    return this.desk.change(actor, appointmentId, 'COMPLETE', ip);
  }

  @Throttle(DESK_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({
    summary:
      "Record that the patient did not come: on the appointment's day, from its start (BR-11)",
  })
  @ApiParam({ name: 'appointmentId', format: 'uuid' })
  @ApiOkResponse({ type: DeskAppointmentRowDto })
  @HttpCode(200)
  @Post('appointments/:appointmentId/no-show')
  async markAppointmentNoShow(
    @CurrentUser() actor: Actor,
    @Param('appointmentId') appointmentId: string,
    @Ip() ip: string,
  ): Promise<DeskAppointmentRowDto> {
    return this.desk.change(actor, appointmentId, 'NO_SHOW', ip);
  }

  @Throttle(DESK_CHANGE_LIMIT)
  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({
    summary: 'Cancel a booked appointment for the practice, with a reason; its time is free again',
  })
  @ApiParam({ name: 'appointmentId', format: 'uuid' })
  @ApiOkResponse({ type: DeskAppointmentRowDto })
  @HttpCode(200)
  @Post('appointments/:appointmentId/cancel')
  async cancelAppointmentAsPractice(
    @CurrentUser() actor: Actor,
    @Param('appointmentId') appointmentId: string,
    @Body() input: CancelAsPracticeDto,
    @Ip() ip: string,
  ): Promise<DeskAppointmentRowDto> {
    return this.desk.cancel(actor, appointmentId, input.cancelReason, ip);
  }
}

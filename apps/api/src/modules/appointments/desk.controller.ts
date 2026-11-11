import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
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
  PRACTICE_AUDIENCE,
  PublicFreeTimesService,
} from '../scheduling/public-free-times.service.js';
import {
  PublicAvailabilityDto,
  PublicAvailabilityQueryDto,
  PublicFreeTimesDto,
  PublicFreeTimesQueryDto,
} from '../scheduling/public-free-times.dto.js';
import { IDEMPOTENCY_HEADER } from './appointments.controller.js';
import { DeskPatients } from './desk-patients.js';
import {
  CancelAsPracticeDto,
  DeskAppointmentDto,
  DeskAppointmentPageDto,
  DeskAppointmentRowDto,
  DeskAppointmentSearchDto,
  DeskBookingDto,
  DeskCatalogDto,
  DeskDayDto,
  DeskDayQueryDto,
  DeskNewPatientDto,
  DeskPatientPageDto,
  DeskPatientRecordDto,
  DeskPatientRowDto,
  DeskPatientSearchDto,
} from './desk.dto.js';
import { DeskService } from './desk.service.js';

/**
 * Per address and minute. A reception checks in a waiting room at opening time, and the team of a
 * practice can share one address behind its router.
 */
const DESK_CHANGE_LIMIT = { default: { limit: 120, ttl: 60_000 } };

/**
 * Per route, address and minute: stricter for a search than the default (health-data-security),
 * with room for a reception whose team shares one address and asks once a typed word settles.
 */
const DESK_SEARCH_LIMIT = { default: { limit: 60, ttl: 60_000 } };

/**
 * Per route, address and minute, stricter than the default for what creates (health-data-security
 * §8): a reception books one patient on the phone at a time, and adds a new one more rarely.
 */
const DESK_BOOK_LIMIT = { default: { limit: 30, ttl: 60_000 } };
const DESK_ADD_PATIENT_LIMIT = { default: { limit: 20, ttl: 60_000 } };

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
  constructor(
    private readonly desk: DeskService,
    private readonly patients: DeskPatients,
    private readonly freeTimes: PublicFreeTimesService,
  ) {}

  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({
    summary: 'Days with free times for the team (W7): every active service and doctor, from now on',
  })
  @ApiOkResponse({ type: PublicAvailabilityDto })
  @Get('availability')
  async getDeskAvailability(
    @Query() query: PublicAvailabilityQueryDto,
  ): Promise<PublicAvailabilityDto> {
    return this.freeTimes.availability(query, PRACTICE_AUDIENCE);
  }

  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({ summary: 'The free times of one day for the team (W7)' })
  @ApiOkResponse({ type: PublicFreeTimesDto })
  @Get('free-times')
  async getDeskFreeTimes(@Query() query: PublicFreeTimesQueryDto): Promise<PublicFreeTimesDto> {
    return this.freeTimes.freeTimesOfDay(query, PRACTICE_AUDIENCE);
  }

  @Throttle(DESK_BOOK_LIMIT)
  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({
    summary: 'Book a free time for a patient of the practice (W7); the row as the desk shows it',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiCreatedResponse({ type: DeskAppointmentRowDto })
  @Post('appointments')
  async bookDeskAppointment(
    @CurrentUser() actor: Actor,
    @Body() input: DeskBookingDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ): Promise<DeskAppointmentRowDto> {
    return this.desk.book(actor, input, idempotencyKey, ip);
  }

  @Throttle(DESK_ADD_PATIENT_LIMIT)
  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({
    summary: 'Add a patient without an account (W7), to book on the phone and at the desk',
  })
  @ApiCreatedResponse({ type: DeskPatientRowDto })
  @Post('patients')
  async addDeskPatient(
    @CurrentUser() actor: Actor,
    @Body() input: DeskNewPatientDto,
    @Ip() ip: string,
  ): Promise<DeskPatientRowDto> {
    return this.patients.add(actor, input, ip);
  }

  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({ summary: 'The doctors and services of the practice, for filters and booking' })
  @ApiOkResponse({ type: DeskCatalogDto })
  @Get('catalog')
  async getDeskCatalog(): Promise<DeskCatalogDto> {
    return this.desk.catalog();
  }

  @Throttle(DESK_SEARCH_LIMIT)
  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({
    summary:
      'The appointments of some days, a page at a time; reads only, and every one shown is audited',
  })
  @ApiOkResponse({ type: DeskAppointmentPageDto })
  @HttpCode(200)
  @Post('appointments/search')
  async searchDeskAppointments(
    @CurrentUser() actor: Actor,
    @Body() search: DeskAppointmentSearchDto,
    @Ip() ip: string,
  ): Promise<DeskAppointmentPageDto> {
    return this.desk.list(actor, search, ip);
  }

  @Throttle(DESK_SEARCH_LIMIT)
  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({
    summary:
      'The patients of the practice, found as the team types; reads only, and every one shown is audited',
  })
  @ApiOkResponse({ type: DeskPatientPageDto })
  @HttpCode(200)
  @Post('patients/search')
  async searchDeskPatients(
    @CurrentUser() actor: Actor,
    @Body() search: DeskPatientSearchDto,
    @Ip() ip: string,
  ): Promise<DeskPatientPageDto> {
    return this.patients.page(actor, search, ip);
  }

  @PracticeScoped('id', { staff: ALL_STAFF_ROLES })
  @ApiOperation({ summary: 'One patient with what is to come and what was; the read is audited' })
  @ApiParam({ name: 'patientId', format: 'uuid' })
  @ApiOkResponse({ type: DeskPatientRecordDto })
  @Get('patients/:patientId')
  async getDeskPatient(
    @CurrentUser() actor: Actor,
    @Param('patientId') patientId: string,
    @Ip() ip: string,
  ): Promise<DeskPatientRecordDto> {
    return this.patients.record(actor, patientId, ip);
  }

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

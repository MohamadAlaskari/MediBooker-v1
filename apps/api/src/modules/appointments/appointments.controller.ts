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
import { PracticeAccessIndex } from '../../common/tenancy/practice-access-index.js';
import { PracticeFanOut } from '../../common/tenancy/practice-fan-out.js';
import { PracticeScoped } from '../../common/tenancy/practice-scoped.decorator.js';
import { AppointmentReader } from './appointment-reader.js';
import {
  AppointmentDto,
  AppointmentListQueryDto,
  AppointmentPageDto,
  BookAppointmentDto,
  MyAppointmentsDto,
  RescheduleAppointmentDto,
} from './appointments.dto.js';
import { AppointmentsService } from './appointments.service.js';

/**
 * Per address and minute, in front of the sign-in; AccountTransactions holds one account to a part
 * of the practice's connections, whatever addresses it has.
 */
const CHANGE_LIMIT = { default: { limit: 10, ttl: 60_000 } };

/** One request can open a client for each of a person's practices, from a budget all of them share. */
const FAN_OUT_LIMIT = { default: { limit: 30, ttl: 60_000 } };

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'A new UUID per attempt: sent again, it answers with the first result',
  schema: { type: 'string', format: 'uuid' },
} as const;

/** Appointments of a practice: who acts comes from the verified token only. */
@ApiTags('appointments')
@ApiBearerAuth()
@ApiCookieAuth('mb_access')
@ApiParam({ name: 'practiceId', format: 'uuid' })
@Controller('practices/:practiceId/appointments')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly reader: AppointmentReader,
  ) {}

  @Throttle(CHANGE_LIMIT)
  @PracticeScoped('id', { patient: true, confirmed: true })
  @ApiOperation({ summary: 'Book a free time for the own profile in this practice' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiCreatedResponse({ type: AppointmentDto })
  @Post()
  async bookAppointment(
    @CurrentUser() actor: Actor,
    @Body() input: BookAppointmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ): Promise<AppointmentDto> {
    return this.appointments.book(actor, input, idempotencyKey, ip);
  }

  @PracticeScoped('id', { patient: true })
  @ApiOperation({ summary: 'An own appointment in this practice' })
  @ApiParam({ name: 'appointmentId', format: 'uuid' })
  @ApiOkResponse({ type: AppointmentDto })
  @Get(':appointmentId')
  async getMyAppointment(@Param('appointmentId') appointmentId: string): Promise<AppointmentDto> {
    return this.reader.own(appointmentId);
  }

  @Throttle(CHANGE_LIMIT)
  @PracticeScoped('id', { patient: true })
  @ApiOperation({ summary: 'Cancel an own appointment, until the deadline of the practice' })
  @ApiParam({ name: 'appointmentId', format: 'uuid' })
  @ApiOkResponse({ type: AppointmentDto })
  @HttpCode(200)
  @Post(':appointmentId/cancel')
  async cancelAppointment(
    @CurrentUser() actor: Actor,
    @Param('appointmentId') appointmentId: string,
    @Ip() ip: string,
  ): Promise<AppointmentDto> {
    return this.appointments.cancel(actor, appointmentId, ip);
  }

  @Throttle(CHANGE_LIMIT)
  @PracticeScoped('id', { patient: true, confirmed: true })
  @ApiOperation({
    summary: 'Move an own appointment to another free time; the service and the note stay',
  })
  @ApiParam({ name: 'appointmentId', format: 'uuid' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiCreatedResponse({ type: AppointmentDto, description: 'The new appointment' })
  @Post(':appointmentId/reschedule')
  async rescheduleAppointment(
    @CurrentUser() actor: Actor,
    @Param('appointmentId') appointmentId: string,
    @Body() input: RescheduleAppointmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ): Promise<AppointmentDto> {
    return this.appointments.reschedule(actor, appointmentId, input, idempotencyKey, ip);
  }
}

/** The caller's appointments in one practice, with the history. */
@ApiTags('appointments')
@ApiBearerAuth()
@ApiCookieAuth('mb_access')
@ApiParam({ name: 'practiceId', format: 'uuid' })
@Controller('practices/:practiceId/me/appointments')
export class MyPracticeAppointmentsController {
  constructor(private readonly reader: AppointmentReader) {}

  @PracticeScoped('id', { patient: true })
  @ApiOperation({ summary: 'The own appointments in this practice, a page at a time' })
  @ApiOkResponse({ type: AppointmentPageDto })
  @Get()
  async listMyAppointmentsInPractice(
    @Query() query: AppointmentListQueryDto,
  ): Promise<AppointmentPageDto> {
    return this.reader.ownPage(query);
  }
}

/** What is still to come across the caller's practices (ADR 0005 §9.1). History stays per practice. */
@ApiTags('me')
@ApiBearerAuth()
@ApiCookieAuth('mb_access')
@Controller('me/appointments')
export class MyAppointmentsController {
  constructor(
    private readonly index: PracticeAccessIndex,
    private readonly fanOut: PracticeFanOut,
    private readonly reader: AppointmentReader,
  ) {}

  @Throttle(FAN_OUT_LIMIT)
  @ApiOperation({ summary: 'The upcoming appointments across the own practices' })
  @ApiOkResponse({ type: MyAppointmentsDto })
  @Get()
  async listMyAppointments(@CurrentUser() { userId }: Actor): Promise<MyAppointmentsDto> {
    const { items, unavailable } = await this.fanOut.read(
      userId,
      await this.index.patientPracticeIdsOf(userId),
      () => this.reader.upcomingOfAccount(userId),
    );
    return {
      items: items.toSorted((a, b) =>
        Temporal.Instant.compare(
          Temporal.Instant.from(a.startsAt),
          Temporal.Instant.from(b.startsAt),
        ),
      ),
      unavailablePractices: unavailable,
    };
  }
}

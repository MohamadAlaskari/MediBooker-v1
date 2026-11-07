import { Body, Controller, Headers, Ip, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Actor } from '../../common/security/actor.js';
import { CurrentUser } from '../../common/security/current-user.decorator.js';
import { PracticeScoped } from '../../common/tenancy/practice-scoped.decorator.js';
import { AppointmentDto, BookAppointmentDto } from './appointments.dto.js';
import { AppointmentsService } from './appointments.service.js';

/**
 * Per address and minute, in front of the sign-in; AccountTransactions holds one account to a part
 * of the practice's connections, whatever addresses it has.
 */
const BOOK_LIMIT = { default: { limit: 10, ttl: 60_000 } };

/** Appointments of a practice: who books comes from the verified token only. */
@ApiTags('appointments')
@ApiBearerAuth()
@ApiCookieAuth('mb_access')
@ApiParam({ name: 'practiceId', format: 'uuid' })
@Controller('practices/:practiceId/appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Throttle(BOOK_LIMIT)
  @PracticeScoped('id', { patient: true, confirmed: true })
  @ApiOperation({ summary: 'Book a free time for the own profile in this practice' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'A new UUID per attempt: sent again, it answers with the first booking',
    schema: { type: 'string', format: 'uuid' },
  })
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
}

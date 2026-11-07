import { Module } from '@nestjs/common';
import { TenancyModule } from '../../common/tenancy/tenancy.module.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { IdempotencyKeySweepJob } from './idempotency-key-sweep.job.js';

/** Booking an appointment (B02). Cancel, reschedule and the own list follow with B03. */
@Module({
  imports: [TenancyModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, IdempotencyKeySweepJob],
})
export class AppointmentsModule {}

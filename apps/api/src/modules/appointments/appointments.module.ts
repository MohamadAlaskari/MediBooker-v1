import { Module } from '@nestjs/common';
import { TenancyModule } from '../../common/tenancy/tenancy.module.js';
import { AppointmentReader } from './appointment-reader.js';
import {
  AppointmentsController,
  MyAppointmentsController,
  MyPracticeAppointmentsController,
} from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { IdempotencyKeySweepJob } from './idempotency-key-sweep.job.js';

/** A patient's appointments (B02, B03). What staff do with them follows with M05. */
@Module({
  imports: [TenancyModule],
  controllers: [AppointmentsController, MyPracticeAppointmentsController, MyAppointmentsController],
  providers: [AppointmentReader, AppointmentsService, IdempotencyKeySweepJob],
})
export class AppointmentsModule {}

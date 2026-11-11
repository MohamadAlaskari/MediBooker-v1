import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../common/database/platform-database.module.js';
import { TenancyModule } from '../../common/tenancy/tenancy.module.js';
import { AppointmentReader } from './appointment-reader.js';
import {
  AppointmentsController,
  MyAppointmentsController,
  MyPracticeAppointmentsController,
} from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { DeskPatients } from './desk-patients.js';
import { DeskRows } from './desk-rows.js';
import { DeskController } from './desk.controller.js';
import { DeskService } from './desk.service.js';
import { IdempotencyKeySweepJob } from './idempotency-key-sweep.job.js';

/** A patient's appointments (B02, B03), and the practice's side of them (M05). */
@Module({
  imports: [PlatformDatabaseModule, TenancyModule],
  controllers: [
    AppointmentsController,
    MyPracticeAppointmentsController,
    MyAppointmentsController,
    DeskController,
  ],
  providers: [
    AppointmentReader,
    AppointmentsService,
    DeskRows,
    DeskPatients,
    DeskService,
    IdempotencyKeySweepJob,
  ],
})
export class AppointmentsModule {}

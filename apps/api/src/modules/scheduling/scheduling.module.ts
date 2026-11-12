import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TenancyModule } from '../../common/tenancy/tenancy.module.js';
import { FreeTimesController } from './free-times.controller.js';
import { FreeTimesService } from './free-times.service.js';
import { SlotGenerationJob } from './slot-generation.job.js';
import { SlotGenerationService } from './slot-generation.service.js';
import { WorkingHoursController } from './working-hours.controller.js';
import { WorkingHours } from './working-hours.service.js';

/**
 * Slots from the providers' rules (P04), the free times for signed-in patients (P05, B07) and for
 * the team's booking (M05, W7), and the doctors' working hours, absences and times (M04, W14).
 */
@Module({
  imports: [ScheduleModule.forRoot(), TenancyModule],
  controllers: [FreeTimesController, WorkingHoursController],
  providers: [FreeTimesService, SlotGenerationJob, SlotGenerationService, WorkingHours],
  exports: [FreeTimesService],
})
export class SchedulingModule {}

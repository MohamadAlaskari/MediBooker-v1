import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TenancyModule } from '../../common/tenancy/tenancy.module.js';
import { PublicFreeTimesController } from './public-free-times.controller.js';
import { PublicFreeTimesService } from './public-free-times.service.js';
import { SlotGenerationJob } from './slot-generation.job.js';
import { SlotGenerationService } from './slot-generation.service.js';
import { WorkingHoursController } from './working-hours.controller.js';
import { WorkingHours } from './working-hours.service.js';

/**
 * Slots from the providers' rules (P04), the free times on the public page (P05) and for the
 * team's booking (M05, W7), and the doctors' working hours, absences and times (M04, W14).
 */
@Module({
  imports: [ScheduleModule.forRoot(), TenancyModule],
  controllers: [PublicFreeTimesController, WorkingHoursController],
  providers: [PublicFreeTimesService, SlotGenerationJob, SlotGenerationService, WorkingHours],
  exports: [PublicFreeTimesService],
})
export class SchedulingModule {}

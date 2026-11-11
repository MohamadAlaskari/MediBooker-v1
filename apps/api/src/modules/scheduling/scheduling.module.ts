import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TenancyModule } from '../../common/tenancy/tenancy.module.js';
import { PublicFreeTimesController } from './public-free-times.controller.js';
import { PublicFreeTimesService } from './public-free-times.service.js';
import { SlotGenerationJob } from './slot-generation.job.js';
import { SlotGenerationService } from './slot-generation.service.js';

/**
 * Slots from the providers' rules (P04), and the free times on the public page (P05) and for the
 * team's booking (M05, W7).
 */
@Module({
  imports: [ScheduleModule.forRoot(), TenancyModule],
  controllers: [PublicFreeTimesController],
  providers: [PublicFreeTimesService, SlotGenerationJob, SlotGenerationService],
  exports: [PublicFreeTimesService],
})
export class SchedulingModule {}

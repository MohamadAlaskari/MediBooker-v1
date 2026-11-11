import { Module } from '@nestjs/common';
import { TenancyModule } from '../../common/tenancy/tenancy.module.js';
import { PracticeHours } from './practice-hours.js';
import { PracticeSetupController } from './practice-setup.controller.js';
import { ServiceCatalog } from './service-catalog.js';

/** The practice's services, opening hours and special days, as the team sets them up (M02). */
@Module({
  imports: [TenancyModule],
  controllers: [PracticeSetupController],
  providers: [ServiceCatalog, PracticeHours],
})
export class PracticeSetupModule {}

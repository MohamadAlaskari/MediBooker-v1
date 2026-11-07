import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../common/database/platform-database.module.js';
import { SecurityModule } from '../../common/security/security.module.js';
import { TenancyModule } from '../../common/tenancy/tenancy.module.js';
import { MyPracticesController, PatientsController } from './patients.controller.js';
import { PatientsService } from './patients.service.js';

/** A person's profile in a practice, and the practices of an account (B01). */
@Module({
  imports: [PlatformDatabaseModule, SecurityModule, TenancyModule],
  controllers: [PatientsController, MyPracticesController],
  providers: [PatientsService],
})
export class PatientsModule {}

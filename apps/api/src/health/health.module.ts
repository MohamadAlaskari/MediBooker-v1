import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../common/database/platform-database.module.js';
import { HealthController } from './health.controller.js';
import { ReadinessService } from './readiness.service.js';

@Module({
  imports: [PlatformDatabaseModule],
  controllers: [HealthController],
  providers: [ReadinessService],
})
export class HealthModule {}

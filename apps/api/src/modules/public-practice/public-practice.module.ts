import { Module } from '@nestjs/common';
import { TenancyModule } from '../../common/tenancy/tenancy.module.js';
import { PublicPracticeController } from './public-practice.controller.js';
import { PublicPracticeService } from './public-practice.service.js';

/** The public practice page's data (P02). Practice resolution comes from the tenancy layer. */
@Module({
  imports: [TenancyModule],
  controllers: [PublicPracticeController],
  providers: [PublicPracticeService],
})
export class PublicPracticeModule {}

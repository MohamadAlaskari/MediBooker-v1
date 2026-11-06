import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../common/database/platform-database.module.js';
import { SecurityModule } from '../../common/security/security.module.js';
import { AccountProfileController } from './account-profile.controller.js';
import { AccountProfileService } from './account-profile.service.js';

/** A person's own details at account level (D16 option B, RT-90). */
@Module({
  imports: [PlatformDatabaseModule, SecurityModule],
  controllers: [AccountProfileController],
  providers: [AccountProfileService],
})
export class AccountProfileModule {}

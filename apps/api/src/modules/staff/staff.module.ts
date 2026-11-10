import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../common/database/platform-database.module.js';
import { TenancyModule } from '../../common/tenancy/tenancy.module.js';
import { MembershipController } from './staff.controller.js';
import { StaffRoles } from './staff-roles.js';

/** The staff of a practice and their roles (A04). Invitations and the team follow with M03. */
@Module({
  imports: [PlatformDatabaseModule, TenancyModule],
  controllers: [MembershipController],
  providers: [StaffRoles],
  exports: [StaffRoles],
})
export class StaffModule {}

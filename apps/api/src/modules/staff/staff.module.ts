import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../common/database/platform-database.module.js';
import { SecurityModule } from '../../common/security/security.module.js';
import { TenancyModule } from '../../common/tenancy/tenancy.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { MembershipController } from './staff.controller.js';
import { StaffRoles } from './staff-roles.js';
import { TeamController } from './team.controller.js';
import { Team } from './team.service.js';

/**
 * The staff of a practice (A04): the own membership, the operator's role command, and the team page
 * of practice management (M03 part 1, D17). Invitations follow with M03 part 2.
 */
@Module({
  imports: [PlatformDatabaseModule, SecurityModule, TenancyModule, NotificationsModule],
  controllers: [MembershipController, TeamController],
  providers: [StaffRoles, Team],
  exports: [StaffRoles],
})
export class StaffModule {}

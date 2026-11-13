import { ApiProperty } from '@nestjs/swagger';
import type { StaffRole } from '../../generated/practice/enums.js';
import { STAFF_ROLES } from './staff-roles.js';

export class MembershipDto {
  @ApiProperty({
    enum: STAFF_ROLES,
    description:
      'The base role (D17): STAFF is the practice team, DOCTOR a doctor; what each may do is in the domain skill',
  })
  readonly role!: StaffRole;

  @ApiProperty({
    description: 'Practice management (D17): services, the team, settings, exports, the audit log',
  })
  readonly managesPractice!: boolean;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The doctor this account is: a doctor changes only its own working hours (M04)',
  })
  readonly providerId!: string | null;
}

import { ApiProperty } from '@nestjs/swagger';
import type { StaffRole } from '../../generated/practice/enums.js';
import { STAFF_ROLES } from './staff-roles.js';

export class MembershipDto {
  @ApiProperty({
    enum: STAFF_ROLES,
    description: 'STAFF is the reception; what a role may do is in the domain skill',
  })
  readonly role!: StaffRole;
}

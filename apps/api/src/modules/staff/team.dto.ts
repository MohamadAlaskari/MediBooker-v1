import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import type { StaffRole } from '../../generated/practice/enums.js';
import { STAFF_ROLES } from './staff-roles.js';

/** One of the practice's doctors, as the team page names it (M04, D17). */
export class TeamDoctorDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ description: 'Title, first and last name, as the practice wrote them' })
  readonly name!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The membership whose account is this doctor; null when none is',
  })
  readonly membershipId!: string | null;
}

/** A member of the practice's team (W15, D17): what practice management sees of it. */
export class TeamMemberDto {
  @ApiProperty({ format: 'uuid', description: 'The membership' })
  readonly id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'First and last name of the account, when it has them',
  })
  readonly name!: string | null;

  @ApiProperty({ format: 'email' })
  readonly email!: string;

  @ApiProperty({ enum: STAFF_ROLES, description: 'The base role: STAFF the practice team' })
  readonly role!: StaffRole;

  @ApiProperty({ description: 'Practice management (D17)' })
  readonly managesPractice!: boolean;

  @ApiProperty({ description: 'False: deactivated, without access to the team pages' })
  readonly active!: boolean;

  @ApiProperty({ description: 'An authenticator app is set up' })
  readonly secondFactor!: boolean;

  @ApiProperty({ type: TeamDoctorDto, nullable: true, description: 'The doctor this account is' })
  readonly doctor!: TeamDoctorDto | null;

  @ApiProperty({ description: 'The membership of whoever asks' })
  readonly you!: boolean;
}

export class TeamDto {
  @ApiProperty({ type: [TeamMemberDto] })
  readonly members!: readonly TeamMemberDto[];

  @ApiProperty({
    type: [TeamDoctorDto],
    description: "The practice's doctors, each with the membership linked to it, if any",
  })
  readonly doctors!: readonly TeamDoctorDto[];
}

/** A new base role, practice management, and for a doctor the doctor it is (D17). */
export class ChangeTeamRoleDto {
  @ApiProperty({ enum: STAFF_ROLES })
  @IsIn(STAFF_ROLES)
  readonly role!: StaffRole;

  @ApiProperty({ description: 'Practice management; the last person with it keeps it' })
  @IsBoolean()
  readonly managesPractice!: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Only with DOCTOR: the doctor this account is. Null takes the link away; left out, a doctor keeps its link',
  })
  @IsOptional()
  @IsUUID()
  readonly providerId?: string | null;
}

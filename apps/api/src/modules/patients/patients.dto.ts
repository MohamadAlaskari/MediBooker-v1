import { PRIVACY_NOTICE_VERSION } from '@medibooker/i18n';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import {
  CALENDAR_DATE,
  INSURANCE_NUMBER,
  MAX_NAME_LENGTH,
  PHONE,
  PLAIN_TEXT,
} from '../account-profile/account-profile.dto.js';
import {
  INSURANCE_TYPES,
  type InsuranceTypeName,
} from '../account-profile/domain/profile.rules.js';

/**
 * A person's details for one practice. Everything is optional: left out, a join copies it from the
 * account's profile and a change keeps it. What is still missing then is named in the answer, so a
 * person is asked only for that. A null is no value, except for a phone, which it removes.
 */
export class PatientDetailsDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: MAX_NAME_LENGTH, pattern: PLAIN_TEXT.source })
  @ValidateIf(({ firstName }: PatientDetailsDto) => firstName !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME_LENGTH)
  @Matches(PLAIN_TEXT)
  readonly firstName?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: MAX_NAME_LENGTH, pattern: PLAIN_TEXT.source })
  @ValidateIf(({ lastName }: PatientDetailsDto) => lastName !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME_LENGTH)
  @Matches(PLAIN_TEXT)
  readonly lastName?: string;

  @ApiPropertyOptional({ format: 'date', pattern: CALENDAR_DATE.source })
  @ValidateIf(({ dateOfBirth }: PatientDetailsDto) => dateOfBirth !== undefined)
  @IsString()
  @Matches(CALENDAR_DATE)
  readonly dateOfBirth?: string;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: PHONE.source })
  @ValidateIf(({ phone }: PatientDetailsDto) => phone !== undefined && phone !== null)
  @IsString()
  @Matches(PHONE)
  readonly phone?: string | null;

  @ApiPropertyOptional({ enum: INSURANCE_TYPES })
  @ValidateIf(({ insuranceType }: PatientDetailsDto) => insuranceType !== undefined)
  @IsIn(INSURANCE_TYPES)
  readonly insuranceType?: InsuranceTypeName;

  @ApiPropertyOptional({ maxLength: MAX_NAME_LENGTH, pattern: PLAIN_TEXT.source })
  @ValidateIf(({ insuranceProvider }: PatientDetailsDto) => insuranceProvider !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME_LENGTH)
  @Matches(PLAIN_TEXT)
  readonly insuranceProvider?: string;

  @ApiPropertyOptional({
    pattern: INSURANCE_NUMBER.source,
    description: 'Left out, the known one stays; the format depends on the practice and its market',
  })
  @ValidateIf(({ insuranceNumber }: PatientDetailsDto) => insuranceNumber !== undefined)
  @IsString()
  @Matches(INSURANCE_NUMBER)
  readonly insuranceNumber?: string;
}

export class JoinPracticeDto extends PatientDetailsDto {
  @ApiPropertyOptional({
    enum: [PRIVACY_NOTICE_VERSION],
    description: 'Needed when the account has no consent to the privacy notice yet',
  })
  @ValidateIf(({ privacyNoticeVersion }: JoinPracticeDto) => privacyNoticeVersion !== undefined)
  @IsIn([PRIVACY_NOTICE_VERSION])
  readonly privacyNoticeVersion?: string;
}

export class UpdatePatientDto extends PatientDetailsDto {}

/** The number itself never leaves the API: a person recognises it by its end. */
export class PatientDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly firstName!: string;

  @ApiProperty()
  readonly lastName!: string;

  @ApiProperty({ format: 'date' })
  readonly dateOfBirth!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly phone!: string | null;

  @ApiProperty({ enum: INSURANCE_TYPES })
  readonly insuranceType!: InsuranceTypeName;

  @ApiProperty({ type: String, nullable: true })
  readonly insuranceProvider!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'The last characters of the number' })
  readonly insuranceNumberEnd!: string | null;
}

export class PatientListDto {
  @ApiProperty({ type: [PatientDto] })
  readonly items!: readonly PatientDto[];
}

const CAPACITIES = ['STAFF', 'PATIENT'] as const;

export class MyPracticeDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Its current slug, when it has one' })
  readonly slug!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Its name per language',
  })
  readonly name!: Readonly<Record<string, string>>;

  @ApiProperty({ enum: CAPACITIES })
  readonly capacity!: (typeof CAPACITIES)[number];
}

export class MyPracticeListDto {
  @ApiProperty({ type: [MyPracticeDto] })
  readonly items!: readonly MyPracticeDto[];
}

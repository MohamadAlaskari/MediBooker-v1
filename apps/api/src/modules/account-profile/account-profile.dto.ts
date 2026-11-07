import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  INSURANCE_TYPES,
  needsInsuranceDetails,
  type InsuranceTypeName,
} from './domain/profile.rules.js';

export const MAX_NAME_LENGTH = 100;
export const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * A name as a person writes it, in any script, but with a visible character and without control or
 * reading-direction characters: a NUL cannot be stored, and an override would disguise a name on
 * the screens of a practice that later shows it.
 */
export const PLAIN_TEXT = /^(?=.*\S)[^\p{Cc}\p{Bidi_Control}]+$/u;
/** At least six digits, of any script: a person types the digits of their keyboard. */
export const PHONE = /^\+?(?=(?:[ ()-]*\p{Nd}){6})[\p{Nd} ()-]{6,20}$/u;
/** Long enough that showing its end does not show all of it. */
export const INSURANCE_NUMBER = /^[\p{L}\p{Nd}][\p{L}\p{Nd} ./-]{5,39}$/u;

/** What a person enters. A self-payer's insurance fields are not asked for, and not kept. */
export class UpdateProfileDto {
  @ApiProperty({ minLength: 1, maxLength: MAX_NAME_LENGTH, pattern: PLAIN_TEXT.source })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME_LENGTH)
  @Matches(PLAIN_TEXT)
  readonly firstName!: string;

  @ApiProperty({ minLength: 1, maxLength: MAX_NAME_LENGTH, pattern: PLAIN_TEXT.source })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME_LENGTH)
  @Matches(PLAIN_TEXT)
  readonly lastName!: string;

  @ApiProperty({ format: 'date', pattern: CALENDAR_DATE.source })
  @IsString()
  @Matches(CALENDAR_DATE)
  readonly dateOfBirth!: string;

  @ApiPropertyOptional({ pattern: PHONE.source })
  @IsOptional()
  @IsString()
  @Matches(PHONE)
  readonly phone?: string;

  @ApiProperty({ enum: INSURANCE_TYPES })
  @IsIn(INSURANCE_TYPES)
  readonly insuranceType!: InsuranceTypeName;

  @ApiPropertyOptional({
    maxLength: MAX_NAME_LENGTH,
    pattern: PLAIN_TEXT.source,
    description: 'Needed unless self-paying',
  })
  @ValidateIf(({ insuranceType }: UpdateProfileDto) => needsInsuranceDetails(insuranceType))
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME_LENGTH)
  @Matches(PLAIN_TEXT)
  readonly insuranceProvider?: string;

  @ApiPropertyOptional({
    pattern: INSURANCE_NUMBER.source,
    description: 'Needed unless self-paying or already known; left out, the known one stays',
  })
  // Not @IsOptional: that also lets a null through, and a null is no number to encrypt.
  @ValidateIf(({ insuranceNumber }: UpdateProfileDto) => insuranceNumber !== undefined)
  @IsString()
  @Matches(INSURANCE_NUMBER)
  readonly insuranceNumber?: string;
}

/** The number itself never leaves the API: a person recognises it by its end. */
export class ProfileDto {
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

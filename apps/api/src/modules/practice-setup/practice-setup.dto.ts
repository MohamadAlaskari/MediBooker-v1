import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  INSURANCE_TYPES,
  type InsuranceTypeName,
} from '../account-profile/domain/profile.rules.js';
import {
  CLOCK_PATTERN,
  SERVICE_DESCRIPTION_MAX,
  SERVICE_NAME_MAX,
  SPECIAL_DAY_LABEL_MAX,
} from './domain/practice-setup.rules.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The bounds of the database's CHECK on `services.duration_minutes`. */
const MIN_DURATION = 5;
const MAX_DURATION = 480;
/** The bound of the database's CHECK on `services.buffer_minutes` (BR-27). */
const MAX_BUFFER = 120;
/** Six intervals on each day of the week are more than any practice opens in. */
const MAX_INTERVALS = 42;

const perLocale = (description: string) =>
  ({
    type: 'object',
    additionalProperties: { type: 'string' },
    description,
  }) as const;

/** How the practice's dates, times and numbers read (03 §8). */
export class SetupDisplayDto {
  @ApiProperty({ description: "The practice's IANA time zone" })
  readonly timeZone!: string;

  @ApiProperty({ description: "The practice's digits" })
  readonly numberingSystem!: string;

  @ApiProperty({ description: "The practice's hour cycle" })
  readonly hourCycle!: string;
}

/** A doctor as the team names them. */
export class SetupProviderDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 'Dr. Lina Mansour' })
  readonly name!: string;
}

/** A service as the admin manages it (W12). */
export class ServiceDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty(perLocale('The name per locale'))
  readonly name!: Readonly<Record<string, string>>;

  @ApiProperty(perLocale('The note patients read before and after booking, per locale'))
  readonly description!: Readonly<Record<string, string>>;

  @ApiProperty({ minimum: MIN_DURATION, maximum: MAX_DURATION })
  readonly durationMinutes!: number;

  @ApiProperty({
    minimum: 0,
    maximum: MAX_BUFFER,
    description: 'Minutes its doctor stays free after it (BR-27)',
  })
  readonly bufferMinutes!: number;

  @ApiProperty({ description: 'Patients bring a referral (BR-26)' })
  readonly referralRequired!: boolean;

  @ApiProperty({ description: 'Patients can book it in the app and the portal (BR-08)' })
  readonly isBookableOnline!: boolean;

  @ApiProperty({
    enum: INSURANCE_TYPES,
    isArray: true,
    description: 'The insurance types it is for; empty: every type the practice takes',
  })
  readonly allowedInsuranceTypes!: readonly InsuranceTypeName[];

  @ApiProperty({ description: 'Offered now; an archived one still names its appointments' })
  readonly active!: boolean;

  @ApiProperty({
    type: [SetupProviderDto],
    description: 'The doctors whose current working hours offer it (M04 changes them)',
  })
  readonly providers!: readonly SetupProviderDto[];
}

/** A doctor of the practice, and whether it has working hours a service can be offered in. */
export class SetupDoctorDto extends SetupProviderDto {
  @ApiProperty({ description: 'Working hours from today on; without, it offers no service' })
  readonly hasWorkingHours!: boolean;
}

/** Every service of the practice, also the archived ones, and what a form needs. */
export class ServiceListDto extends SetupDisplayDto {
  @ApiProperty({ type: [ServiceDto] })
  readonly services!: readonly ServiceDto[];

  @ApiProperty({
    type: [String],
    example: ['ar', 'en'],
    description: "The practice's languages: a name is needed in each",
  })
  readonly locales!: readonly string[];

  @ApiProperty({
    enum: INSURANCE_TYPES,
    isArray: true,
    description: 'The types the practice takes',
  })
  readonly insuranceTypes!: readonly InsuranceTypeName[];

  @ApiProperty({ type: [SetupDoctorDto], description: "The practice's doctors, for W13" })
  readonly doctors!: readonly SetupDoctorDto[];
}

/** The doctors who offer a service: the service is added to their working hours or taken out. */
export class ServiceProvidersInputDto {
  @ApiProperty({ type: [String], maxItems: 100, description: 'Doctors with working hours' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  readonly providerIds!: readonly string[];
}

/** A new service (W13). */
export class ServiceInputDto {
  @ApiProperty({
    ...perLocale(
      `In every language of the practice, at most ${String(SERVICE_NAME_MAX)} characters`,
    ),
    example: { ar: 'فحص عام', en: 'Check-up' },
  })
  @IsObject()
  readonly name!: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional({
    ...perLocale(`At most ${String(SERVICE_DESCRIPTION_MAX)} characters per language`),
    example: { en: 'Please come fasting.' },
  })
  @IsOptional()
  @IsObject()
  readonly description?: Readonly<Record<string, unknown>>;

  @ApiProperty({ minimum: MIN_DURATION, maximum: MAX_DURATION, example: 30 })
  @IsInt()
  @Min(MIN_DURATION)
  @Max(MAX_DURATION)
  readonly durationMinutes!: number;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_BUFFER, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_BUFFER)
  readonly bufferMinutes?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  readonly referralRequired?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  readonly isBookableOnline?: boolean;

  @ApiPropertyOptional({
    enum: INSURANCE_TYPES,
    isArray: true,
    description: 'Types the practice takes; empty or left out: all of them',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(INSURANCE_TYPES.length)
  @IsIn(INSURANCE_TYPES, { each: true })
  readonly allowedInsuranceTypes?: readonly InsuranceTypeName[];
}

/** A change of a service: only what is given changes; `active: false` archives it. */
export class ServicePatchDto {
  @ApiPropertyOptional(perLocale('In every language of the practice'))
  @IsOptional()
  @IsObject()
  readonly name?: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional(perLocale('Replaces the note in every language'))
  @IsOptional()
  @IsObject()
  readonly description?: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional({ minimum: MIN_DURATION, maximum: MAX_DURATION })
  @IsOptional()
  @IsInt()
  @Min(MIN_DURATION)
  @Max(MAX_DURATION)
  readonly durationMinutes?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_BUFFER })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_BUFFER)
  readonly bufferMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  readonly referralRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  readonly isBookableOnline?: boolean;

  @ApiPropertyOptional({ enum: INSURANCE_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(INSURANCE_TYPES.length)
  @IsIn(INSURANCE_TYPES, { each: true })
  readonly allowedInsuranceTypes?: readonly InsuranceTypeName[];

  @ApiPropertyOptional({
    description: 'False archives it: nobody can book it; its appointments stay',
  })
  @IsOptional()
  @IsBoolean()
  readonly active?: boolean;
}

/** An interval in which the practice is open, in its local time. */
export class OpeningIntervalDto {
  @ApiProperty({ minimum: 1, maximum: 7, description: 'ISO weekday: 1 Monday to 7 Sunday' })
  @IsInt()
  @Min(1)
  @Max(7)
  readonly weekday!: number;

  @ApiProperty({ pattern: CLOCK_PATTERN.source, example: '08:00' })
  @IsString()
  @Matches(CLOCK_PATTERN)
  readonly opensAt!: string;

  @ApiProperty({
    pattern: CLOCK_PATTERN.source,
    example: '16:00',
    description: '24:00 is the end of the day',
  })
  @IsString()
  @Matches(CLOCK_PATTERN)
  readonly closesAt!: string;
}

/** The practice's week (W20), and how its calendar runs. */
export class OpeningHoursDto extends SetupDisplayDto {
  @ApiProperty({ type: [OpeningIntervalDto], description: 'By weekday and time' })
  readonly intervals!: readonly OpeningIntervalDto[];

  @ApiProperty({ description: 'ISO weekday the week starts on', example: 7 })
  readonly weekStart!: number;

  @ApiProperty({ type: [Number], description: 'ISO weekdays', example: [5, 6] })
  readonly weekendDays!: readonly number[];
}

/** The whole week at once: a day without intervals is closed. */
export class OpeningHoursInputDto {
  @ApiProperty({ type: [OpeningIntervalDto], maxItems: MAX_INTERVALS })
  @IsArray()
  @ArrayMaxSize(MAX_INTERVALS)
  @ValidateNested({ each: true })
  @Type(() => OpeningIntervalDto)
  readonly intervals!: readonly OpeningIntervalDto[];
}

/** A date with other hours, or closed (BR-22). */
export class SpecialDayDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'date', description: "On the practice's calendar", example: '2026-11-19' })
  readonly date!: string;

  @ApiProperty()
  readonly closed!: boolean;

  @ApiProperty({ type: String, nullable: true, example: null })
  readonly opensAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  readonly closesAt!: string | null;

  @ApiProperty(perLocale('Why, per locale, such as "Team training"'))
  readonly label!: Readonly<Record<string, string>>;
}

/** The special days from today on, and what a form needs. */
export class SpecialDayListDto extends SetupDisplayDto {
  @ApiProperty({ type: [SpecialDayDto] })
  readonly specialDays!: readonly SpecialDayDto[];

  @ApiProperty({ format: 'date', description: "Today on the practice's calendar" })
  readonly today!: string;

  @ApiProperty({ type: [String], example: ['ar', 'en'] })
  readonly locales!: readonly string[];
}

/** A new special day: closed, or open with other hours. */
export class SpecialDayInputDto {
  @ApiProperty({
    format: 'date',
    pattern: ISO_DATE.source,
    description: "From today to two years ahead, on the practice's calendar",
  })
  @IsString()
  @Matches(ISO_DATE)
  readonly date!: string;

  @ApiProperty()
  @IsBoolean()
  readonly closed!: boolean;

  @ApiPropertyOptional({ pattern: CLOCK_PATTERN.source, description: 'Only when open' })
  @IsOptional()
  @IsString()
  @Matches(CLOCK_PATTERN)
  readonly opensAt?: string;

  @ApiPropertyOptional({ pattern: CLOCK_PATTERN.source, description: 'Only when open' })
  @IsOptional()
  @IsString()
  @Matches(CLOCK_PATTERN)
  readonly closesAt?: string;

  @ApiPropertyOptional(
    perLocale(`At most ${String(SPECIAL_DAY_LABEL_MAX)} characters per language`),
  )
  @IsOptional()
  @IsObject()
  readonly label?: Readonly<Record<string, unknown>>;
}

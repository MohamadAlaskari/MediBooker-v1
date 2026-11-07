import { ApiProperty } from '@nestjs/swagger';
import type { CursorPage } from '../../common/http/cursor-page.js';
import {
  INSURANCE_TYPES,
  type InsuranceTypeName,
} from '../account-profile/domain/profile.rules.js';

/**
 * What leaves the API about a practice without sign-in: exactly these fields (BR-22, BR-24).
 * Every field is named here and copied one by one, so a new column never becomes public by itself.
 */

export class PublicPracticeListItemDto {
  @ApiProperty({ description: 'The current slug', example: 'al-noor' })
  readonly slug!: string;
}

export class PublicPracticeListDto implements CursorPage<PublicPracticeListItemDto> {
  @ApiProperty({ type: [PublicPracticeListItemDto] })
  readonly items!: readonly PublicPracticeListItemDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null on the last page',
    example: null,
  })
  readonly nextCursor!: string | null;
}

export class PublicThemeDto {
  @ApiProperty({ example: 'TEAL' })
  readonly preset!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  readonly customColor!: string | null;

  @ApiProperty({ type: [String], description: 'Empty, or 11 steps with a custom colour' })
  readonly scale!: readonly string[];

  @ApiProperty()
  readonly adjusted!: boolean;

  @ApiProperty({ type: String, nullable: true, description: 'Null until logos are stored' })
  readonly logoUrl!: null;

  @ApiProperty({ type: String, nullable: true, example: 'LH' })
  readonly initials!: string | null;
}

export class PublicOpeningHoursDto {
  @ApiProperty({ description: 'ISO weekday: 1 Monday to 7 Sunday', example: 1 })
  readonly weekday!: number;

  @ApiProperty({ description: 'Local wall-clock time', example: '09:00' })
  readonly opensAt!: string;

  @ApiProperty({
    description: 'Local wall-clock time; 24:00 is the end of the day',
    example: '13:00',
  })
  readonly closesAt!: string;
}

export class PublicSpecialDayDto {
  @ApiProperty({ description: "ISO date in the practice's time zone", example: '2026-11-19' })
  readonly date!: string;

  @ApiProperty()
  readonly closed!: boolean;

  @ApiProperty({ type: String, nullable: true, example: null })
  readonly opensAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  readonly closesAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Team training' })
  readonly label!: string | null;
}

export class PublicServiceDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Check-up' })
  readonly name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly description!: string | null;

  @ApiProperty({ example: 20 })
  readonly durationMinutes!: number;
}

export class PublicTeamMemberDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Dr.' })
  readonly title!: string | null;

  @ApiProperty()
  readonly firstName!: string;

  @ApiProperty()
  readonly lastName!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly position!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly specialty!: string | null;

  @ApiProperty({ type: [String], example: ['ar', 'en'] })
  readonly languages!: readonly string[];

  @ApiProperty()
  readonly isProvider!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null until photos are stored, which also need their own consent',
  })
  readonly photoUrl!: null;
}

export class PublicPracticeDto {
  @ApiProperty({ format: 'uuid', description: 'What the routes of a signed-in patient name it by' })
  readonly id!: string;

  @ApiProperty({
    enum: INSURANCE_TYPES,
    isArray: true,
    description: 'The insurance types this practice takes (BR-10)',
  })
  readonly insuranceTypes!: readonly InsuranceTypeName[];

  @ApiProperty({
    enum: INSURANCE_TYPES,
    isArray: true,
    description: 'The insurance types for which this practice asks for a provider (BR-10)',
  })
  readonly insuranceProviderTypes!: readonly InsuranceTypeName[];

  @ApiProperty({
    enum: INSURANCE_TYPES,
    isArray: true,
    description: 'The insurance types for which this practice asks for a number (BR-10)',
  })
  readonly insuranceNumberTypes!: readonly InsuranceTypeName[];

  @ApiProperty({
    description: 'Until how many hours before the start a patient can change an appointment online',
  })
  readonly cancellationDeadlineHours!: number;

  @ApiProperty({
    description: 'The current slug, also when the request used a retired one',
    example: 'al-noor',
  })
  readonly slug!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly name!: string | null;

  @ApiProperty({
    description: 'The locale of the texts in this response, also in Content-Language',
    example: 'ar',
  })
  readonly locale!: string;

  @ApiProperty({ example: 'ar' })
  readonly defaultLocale!: string;

  @ApiProperty({ type: [String], example: ['ar', 'en'] })
  readonly supportedLocales!: readonly string[];

  @ApiProperty({
    description: 'IANA zone: every wall-clock time here is local to it',
    example: 'Asia/Riyadh',
  })
  readonly timeZone!: string;

  @ApiProperty({ description: 'ISO weekday', example: 7 })
  readonly weekStart!: number;

  @ApiProperty({ type: [Number], description: 'ISO weekdays', example: [5, 6] })
  readonly weekendDays!: readonly number[];

  @ApiProperty({ example: 'latn' })
  readonly numberingSystem!: string;

  @ApiProperty({ example: 'h23' })
  readonly hourCycle!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly phone!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly address!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly about!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null when the practice hides its directions',
  })
  readonly directions!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly legalNoticeUrl!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly privacyPolicyUrl!: string | null;

  @ApiProperty({ type: PublicThemeDto })
  readonly theme!: PublicThemeDto;

  @ApiProperty({
    description: "Today's date in the practice's time zone",
    example: '2026-11-06',
  })
  readonly today!: string;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description: 'Null when the practice hides its opening hours',
  })
  readonly openNow!: boolean | null;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description:
      'When openNow changes; null when it does not within 60 days or the hours are hidden',
  })
  readonly nextChangeAt!: string | null;

  @ApiProperty({ type: [PublicOpeningHoursDto] })
  readonly openingHours!: readonly PublicOpeningHoursDto[];

  @ApiProperty({ type: [PublicSpecialDayDto], description: 'The next 60 days' })
  readonly specialDays!: readonly PublicSpecialDayDto[];

  @ApiProperty({ type: [PublicServiceDto], description: 'Active and bookable online' })
  readonly services!: readonly PublicServiceDto[];

  @ApiProperty({
    type: [PublicTeamMemberDto],
    description: 'Only members with an active public-profile consent that no admin has hidden',
  })
  readonly team!: readonly PublicTeamMemberDto[];
}

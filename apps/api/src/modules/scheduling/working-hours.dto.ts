import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CLOCK_PATTERN } from './domain/working-hours.rules.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The bounds of the database's CHECK on `availability_rules.slot_minutes`. */
const MIN_SLOT = 5;
const MAX_SLOT = 240;
/** Six intervals on each day of the week are more than a doctor works in. */
const MAX_INTERVALS = 42;
const MAX_SERVICES = 100;

export const ABSENCE_REASONS = ['VACATION', 'HOLIDAY', 'TRAINING', 'OTHER'] as const;
export type AbsenceReason = (typeof ABSENCE_REASONS)[number];
export const SLOT_STATES = ['OPEN', 'BLOCKED'] as const;

/** How the practice's dates, times and numbers read, and how its week runs (03 §8). */
export class ScheduleDisplayDto {
  @ApiProperty({ description: "The practice's IANA time zone" })
  readonly timeZone!: string;

  @ApiProperty({ description: "The practice's digits" })
  readonly numberingSystem!: string;

  @ApiProperty({ description: "The practice's hour cycle" })
  readonly hourCycle!: string;

  @ApiProperty({ description: 'ISO weekday the week starts on', example: 7 })
  readonly weekStart!: number;

  @ApiProperty({ format: 'date', description: "Today on the practice's calendar" })
  readonly today!: string;
}

/** An interval of a doctor's week, in the practice's local time. */
export class WorkingIntervalDto {
  @ApiProperty({ minimum: 1, maximum: 7, description: 'ISO weekday: 1 Monday to 7 Sunday' })
  @IsInt()
  @Min(1)
  @Max(7)
  readonly weekday!: number;

  @ApiProperty({ pattern: CLOCK_PATTERN.source, example: '08:00' })
  @IsString()
  @Matches(CLOCK_PATTERN)
  readonly startsAt!: string;

  @ApiProperty({
    pattern: CLOCK_PATTERN.source,
    example: '12:00',
    description: '24:00 is midnight',
  })
  @IsString()
  @Matches(CLOCK_PATTERN)
  readonly endsAt!: string;
}

/** What the doctor's free times are now, for W14's card. */
export class BookingTimesDto {
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: 'The last day with a free time, on the practice calendar; null: none',
  })
  readonly openUntil!: string | null;

  @ApiProperty({ description: 'Free times from now on that a service can be booked in' })
  readonly freeTimes!: number;
}

/** A doctor's week as it holds from today (W14), with its free times. */
export class WorkingHoursDto extends ScheduleDisplayDto {
  @ApiProperty({ format: 'uuid' })
  readonly providerId!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Minutes between start times; null: no working hours yet',
  })
  readonly slotMinutes!: number | null;

  @ApiProperty({ type: [WorkingIntervalDto], description: 'By weekday and time' })
  readonly intervals!: readonly WorkingIntervalDto[];

  @ApiProperty({
    type: [String],
    description: 'The services patients can book in these hours (BR-08)',
  })
  readonly serviceIds!: readonly string[];

  @ApiProperty({ type: BookingTimesDto })
  readonly booking!: BookingTimesDto;
}

/** A doctor's new week, from today on: the free times follow at once. */
export class WorkingHoursInputDto {
  @ApiProperty({ minimum: MIN_SLOT, maximum: MAX_SLOT, example: 15 })
  @IsInt()
  @Min(MIN_SLOT)
  @Max(MAX_SLOT)
  readonly slotMinutes!: number;

  @ApiProperty({ type: [WorkingIntervalDto], maxItems: MAX_INTERVALS })
  @IsArray()
  @ArrayMaxSize(MAX_INTERVALS)
  @ValidateNested({ each: true })
  @Type(() => WorkingIntervalDto)
  readonly intervals!: readonly WorkingIntervalDto[];

  @ApiProperty({ type: [String], maxItems: MAX_SERVICES })
  @IsArray()
  @ArrayMaxSize(MAX_SERVICES)
  @IsUUID('all', { each: true })
  readonly serviceIds!: readonly string[];
}

/** A time a doctor is away (BR-06): no free times are made in it. */
export class AbsenceDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'date-time' })
  readonly startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  readonly endsAt!: string;

  @ApiProperty({ enum: ABSENCE_REASONS })
  readonly reason!: AbsenceReason;

  @ApiProperty({ description: 'Whole days of the practice, from midnight to midnight' })
  readonly allDay!: boolean;
}

/** A new absence, with the booked appointments that fall in it, which the team moves or cancels. */
export class AbsenceCreatedDto extends AbsenceDto {
  @ApiProperty({ description: 'Booked appointments of the doctor in this time' })
  readonly bookedInside!: number;
}

/** A doctor's absences that are not over. */
export class AbsenceListDto extends ScheduleDisplayDto {
  @ApiProperty({ type: [AbsenceDto] })
  readonly absences!: readonly AbsenceDto[];
}

/** An absence as the team enters it: whole days, or a time of one day. */
export class AbsenceInputDto {
  @ApiProperty({ format: 'date', pattern: ISO_DATE.source })
  @IsString()
  @Matches(ISO_DATE)
  readonly startDate!: string;

  @ApiProperty({ format: 'date', pattern: ISO_DATE.source, description: 'Inclusive' })
  @IsString()
  @Matches(ISO_DATE)
  readonly endDate!: string;

  @ApiPropertyOptional({ pattern: CLOCK_PATTERN.source, description: 'Only for one day' })
  @IsOptional()
  @IsString()
  @Matches(CLOCK_PATTERN)
  readonly startTime?: string;

  @ApiPropertyOptional({ pattern: CLOCK_PATTERN.source, description: 'Only for one day' })
  @IsOptional()
  @IsString()
  @Matches(CLOCK_PATTERN)
  readonly endTime?: string;

  @ApiProperty({ enum: ABSENCE_REASONS })
  @IsIn(ABSENCE_REASONS)
  readonly reason!: AbsenceReason;
}

/** What a new run of the free times did. */
export class SlotGenerationDto {
  @ApiProperty()
  readonly created!: number;

  @ApiProperty({ description: 'Free times that no rule wants any more' })
  readonly removed!: number;
}

/** Block or free a time (BR-07). */
export class SlotChangeDto {
  @ApiProperty({ enum: SLOT_STATES })
  @IsIn(SLOT_STATES)
  readonly status!: (typeof SLOT_STATES)[number];
}

/** A time of a doctor, as the calendar shows it. */
export class ScheduleSlotDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly providerId!: string;

  @ApiProperty({ format: 'date-time' })
  readonly startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  readonly endsAt!: string;

  @ApiProperty({ enum: ['OPEN', 'BOOKED', 'BLOCKED'] })
  readonly status!: 'OPEN' | 'BOOKED' | 'BLOCKED';
}

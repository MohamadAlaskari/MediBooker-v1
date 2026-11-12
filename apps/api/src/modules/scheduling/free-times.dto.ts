import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What a signed-in patient learns about a practice's times (BR-22), and the team for W7: whether a
 * day has a free time, and which times are free. Never a count, never a booked time, and a provider
 * only if the person chose one. Never a slot id either: two answers could be compared by it, which
 * would show the times and absences of a provider without a public profile (BR-24). What remains is
 * accepted in BR-24: "any doctor" holds the times of doctors without a public profile too.
 */

export class AvailabilityQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  readonly serviceId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'A doctor: for a patient one with a public profile (BR-24)',
  })
  @IsOptional()
  @IsUUID()
  readonly providerId?: string;

  @ApiPropertyOptional({
    description: "First day, in the practice's time zone; default: today",
    example: '2026-11-15',
  })
  @IsOptional()
  @Matches(PLAIN_DATE)
  @IsISO8601({ strict: true })
  readonly from?: string;

  @ApiPropertyOptional({
    description: 'Last day; at most 42 days in all; default: the 42nd day',
    example: '2026-12-26',
  })
  @IsOptional()
  @Matches(PLAIN_DATE)
  @IsISO8601({ strict: true })
  readonly to?: string;
}

export class FreeTimesQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  readonly serviceId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'A doctor: for a patient one with a public profile (BR-24)',
  })
  @IsOptional()
  @IsUUID()
  readonly providerId?: string;

  @ApiProperty({ description: "A day in the practice's time zone", example: '2026-11-15' })
  @Matches(PLAIN_DATE)
  @IsISO8601({ strict: true })
  readonly date!: string;
}

export class AvailabilityDayDto {
  @ApiProperty({ description: "ISO date in the practice's time zone", example: '2026-11-15' })
  readonly date!: string;

  @ApiProperty()
  readonly hasFreeTimes!: boolean;
}

export class AvailabilityDto {
  @ApiProperty({ type: [AvailabilityDayDto] })
  readonly days!: readonly AvailabilityDayDto[];
}

export class FreeTimeDto {
  @ApiProperty({ description: 'An instant', example: '2026-11-15T09:00:00Z' })
  readonly startsAt!: string;
}

export class FreeTimesDto {
  @ApiProperty({ description: "ISO date in the practice's time zone", example: '2026-11-15' })
  readonly date!: string;

  @ApiProperty({ type: [FreeTimeDto] })
  readonly times!: readonly FreeTimeDto[];
}

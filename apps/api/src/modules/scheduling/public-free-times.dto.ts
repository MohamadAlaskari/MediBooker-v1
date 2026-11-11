import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What the public learns about a practice's times: whether a day has a free time, and which times
 * are free. Never a count, never a booked time, and a provider only if the visitor chose one. Never
 * a slot id either: two answers could be compared by it, which would show the times and absences
 * of a provider without a public profile (BR-24).
 */

export class PublicAvailabilityQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  readonly serviceId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'A doctor: on the public routes one with a public profile',
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

export class PublicFreeTimesQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  readonly serviceId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'A doctor: on the public routes one with a public profile',
  })
  @IsOptional()
  @IsUUID()
  readonly providerId?: string;

  @ApiProperty({ description: "A day in the practice's time zone", example: '2026-11-15' })
  @Matches(PLAIN_DATE)
  @IsISO8601({ strict: true })
  readonly date!: string;
}

export class PublicAvailabilityDayDto {
  @ApiProperty({ description: "ISO date in the practice's time zone", example: '2026-11-15' })
  readonly date!: string;

  @ApiProperty()
  readonly hasFreeTimes!: boolean;
}

export class PublicAvailabilityDto {
  @ApiProperty({ type: [PublicAvailabilityDayDto] })
  readonly days!: readonly PublicAvailabilityDayDto[];
}

export class PublicFreeTimeDto {
  @ApiProperty({ description: 'An instant', example: '2026-11-15T09:00:00Z' })
  readonly startsAt!: string;
}

export class PublicFreeTimesDto {
  @ApiProperty({ description: "ISO date in the practice's time zone", example: '2026-11-15' })
  readonly date!: string;

  @ApiProperty({ type: [PublicFreeTimeDto] })
  readonly times!: readonly PublicFreeTimeDto[];
}

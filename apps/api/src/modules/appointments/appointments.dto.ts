import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

const MAX_NOTE_LENGTH = 500;
/** With an offset, so that it names one instant. A date without a time is no time to book. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
/**
 * What a person writes for the practice, also over several lines, but with a visible character and
 * without what a screen would not show or would disguise it with: control and format characters,
 * also the invisible tag characters and reading-direction marks, and unassigned code points. The
 * joiners stay, because Arabic and Persian text and emoji need them.
 */
const NOTE_TEXT =
  /^(?=[\s\S]*[^\s\u{200C}\u{200D}])(?:[^\p{C}\p{Zl}\p{Zp}]|[\n\u{200C}\u{200D}])+$/u;

/** A time, not a slot: the answers about free times name no slot, and the booking picks one. */
export class BookAppointmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  readonly serviceId!: string;

  @ApiProperty({ format: 'date-time', pattern: INSTANT.source })
  @IsString()
  @Matches(INSTANT)
  readonly startsAt!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'A doctor with a public profile; left out, any doctor free at that time',
  })
  @ValidateIf(({ providerId }: BookAppointmentDto) => providerId !== undefined)
  @IsUUID('all')
  readonly providerId?: string;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: MAX_NOTE_LENGTH,
    pattern: NOTE_TEXT.source,
    description: 'For the practice. It is health data: stored encrypted, and never logged',
  })
  @ValidateIf(({ patientNote }: BookAppointmentDto) => patientNote !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NOTE_LENGTH)
  @Matches(NOTE_TEXT)
  readonly patientNote?: string;
}

const STATUSES = ['BOOKED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const;

export class AppointmentDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly patientId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly serviceId!: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: 'string',
    description: 'The doctor, only with a public profile (BR-24); null, the practice will say who',
  })
  readonly providerId!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  readonly endsAt!: string;

  @ApiProperty({ enum: STATUSES })
  readonly status!: (typeof STATUSES)[number];

  @ApiProperty({ format: 'date-time' })
  readonly bookedAt!: string;
}

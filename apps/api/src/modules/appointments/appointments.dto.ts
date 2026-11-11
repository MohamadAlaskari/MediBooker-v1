import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CursorQueryDto } from '../../common/http/cursor-page.js';
import { FAN_OUT_REASONS, type FanOutReason } from '../../common/tenancy/practice-fan-out.js';

export const MAX_NOTE_LENGTH = 500;
/** With an offset, so that it names one instant. A date without a time is no time to book. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
/**
 * What a person writes for the practice, also over several lines, but with a visible character and
 * without what a screen would not show or would disguise it with: control and format characters,
 * also the invisible tag characters and reading-direction marks, and unassigned code points. The
 * joiners stay, because Arabic and Persian text and emoji need them.
 */
export const NOTE_TEXT =
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

/** Another time for the same service: the service stays, and so does a note. */
export class RescheduleAppointmentDto {
  @ApiProperty({ format: 'date-time', pattern: INSTANT.source })
  @IsString()
  @Matches(INSTANT)
  readonly startsAt!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'A doctor with a public profile; left out, any doctor free at that time',
  })
  @ValidateIf(({ providerId }: RescheduleAppointmentDto) => providerId !== undefined)
  @IsUUID('all')
  readonly providerId?: string;
}

const SCOPES = ['upcoming', 'past'] as const;
export type AppointmentScope = (typeof SCOPES)[number];

export class AppointmentListQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({
    enum: SCOPES,
    default: 'upcoming',
    description: 'upcoming: what is still to come, soonest first; past: the rest, latest first',
  })
  @IsOptional()
  @IsIn(SCOPES)
  readonly scope: AppointmentScope = 'upcoming';
}

const STATUSES = ['BOOKED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const;

/** An appointment as its patient sees it. The note is not sent back. */
export class AppointmentDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly practiceId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly patientId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly serviceId!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'The name of the service per locale',
  })
  readonly serviceName!: Readonly<Record<string, string>>;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: 'string',
    description: 'The doctor, only with a public profile (BR-24); null, the practice will say who',
  })
  readonly providerId!: string | null;

  @ApiProperty({ nullable: true, type: 'string', description: 'Only with a public profile, too' })
  readonly providerName!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  readonly endsAt!: string;

  @ApiProperty({ description: "The practice's IANA time zone, in which to show the times" })
  readonly timeZone!: string;

  @ApiProperty({ description: "The practice's digits, for showing the times" })
  readonly numberingSystem!: string;

  @ApiProperty({ description: "The practice's hour cycle, for showing the times" })
  readonly hourCycle!: string;

  @ApiProperty({ enum: STATUSES })
  readonly status!: (typeof STATUSES)[number];

  @ApiProperty({ format: 'date-time' })
  readonly bookedAt!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'The last moment the patient can cancel or reschedule online (BR-04)',
  })
  readonly changeableUntil!: string;

  @ApiProperty({ description: 'Whether the patient can cancel or reschedule it online right now' })
  readonly changeable!: boolean;

  @ApiProperty({
    description:
      'Whether its start has come, by the clock of the API; the status does not say so until staff set it',
  })
  readonly started!: boolean;
}

export class AppointmentPageDto {
  @ApiProperty({ type: [AppointmentDto] })
  readonly items!: readonly AppointmentDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Null on the last page' })
  readonly nextCursor!: string | null;
}

export class UnavailablePracticeDto {
  @ApiProperty({ format: 'uuid' })
  readonly practiceId!: string;

  @ApiProperty({
    enum: FAN_OUT_REASONS,
    description:
      'UNAVAILABLE: it cannot be served now; TIMEOUT: it took too long; LIMIT: beyond the first practices',
  })
  readonly reason!: FanOutReason;
}

/** What loaded across the practices, and what did not: a client shows both (ADR 0005 §9.1). */
export class MyAppointmentsDto {
  @ApiProperty({ type: [AppointmentDto] })
  readonly items!: readonly AppointmentDto[];

  @ApiProperty({ type: [UnavailablePracticeDto] })
  readonly unavailablePractices!: readonly UnavailablePracticeDto[];
}

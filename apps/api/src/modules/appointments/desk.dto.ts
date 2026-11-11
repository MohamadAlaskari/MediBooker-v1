import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { MAX_NOTE_LENGTH, NOTE_TEXT } from './appointments.dto.js';
import {
  APPOINTMENT_STATUSES,
  type AppointmentStatusName,
  DAY_RELATIONS,
  type DayRelation,
  DESK_ACTIONS,
  type DeskAction,
} from './domain/desk.rules.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSURANCE_TYPES = ['PUBLIC', 'PRIVATE', 'SELF_PAY'] as const;

export class DeskDayQueryDto {
  @ApiPropertyOptional({
    format: 'date',
    pattern: ISO_DATE.source,
    description: "A day of the practice's calendar; left out, today in the practice's time zone",
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE)
  readonly date?: string;
}

/** Why the practice cancels (BR-04). The patient is not told the reason. */
export class CancelAsPracticeDto {
  @ApiProperty({
    minLength: 1,
    maxLength: MAX_NOTE_LENGTH,
    pattern: NOTE_TEXT.source,
    description:
      'Why the practice cancels, for the team only. It can be health data: stored encrypted, never logged',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NOTE_LENGTH)
  @Matches(NOTE_TEXT)
  readonly cancelReason!: string;
}

/** The patient as a row of the day shows them. */
export class DeskPatientDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly firstName!: string;

  @ApiProperty()
  readonly lastName!: string;

  @ApiProperty({ enum: INSURANCE_TYPES })
  readonly insuranceType!: (typeof INSURANCE_TYPES)[number];
}

/** An appointment as the practice's team sees it in a list: never the note, never a reason. */
export class DeskAppointmentRowDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ type: DeskPatientDto })
  readonly patient!: DeskPatientDto;

  @ApiProperty({ format: 'uuid' })
  readonly serviceId!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'The name of the service per locale',
  })
  readonly serviceName!: Readonly<Record<string, string>>;

  @ApiProperty()
  readonly durationMinutes!: number;

  @ApiProperty({ format: 'uuid' })
  readonly providerId!: string;

  @ApiProperty({
    description: 'Every doctor is named for the team, with or without a public profile',
  })
  readonly providerName!: string;

  @ApiProperty({ format: 'date-time' })
  readonly startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  readonly endsAt!: string;

  @ApiProperty({ enum: APPOINTMENT_STATUSES })
  readonly status!: AppointmentStatusName;

  @ApiProperty({ description: 'Booked by the patient online; false when the practice booked it' })
  readonly bookedOnline!: boolean;

  @ApiProperty({ format: 'date-time', nullable: true, type: 'string' })
  readonly checkedInAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: 'string' })
  readonly completedAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: 'string' })
  readonly cancelledAt!: string | null;

  @ApiProperty({ description: 'Cancelled by the practice, with a reason; false for anything else' })
  readonly cancelledByPractice!: boolean;

  @ApiProperty({
    enum: DAY_RELATIONS,
    description: "Its day against today, both in the practice's time zone, by the clock of the API",
  })
  readonly day!: DayRelation;

  @ApiProperty({ description: 'Whether its start has come, by the clock of the API' })
  readonly started!: boolean;

  @ApiProperty({
    enum: DESK_ACTIONS,
    isArray: true,
    description: 'What the team can do with it now (BR-04, BR-11)',
  })
  readonly actions!: readonly DeskAction[];
}

export class DeskDayCountsDto {
  @ApiProperty()
  readonly booked!: number;

  @ApiProperty()
  readonly checkedIn!: number;

  @ApiProperty()
  readonly completed!: number;

  @ApiProperty()
  readonly noShow!: number;

  @ApiProperty()
  readonly cancelled!: number;
}

/** A day of the practice (W1): its appointments in the order of time, and what is left free. */
export class DeskDayDto {
  @ApiProperty({ format: 'date' })
  readonly date!: string;

  @ApiProperty({ format: 'date', description: "Today on the practice's calendar" })
  readonly today!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'The moment of the answer by the clock of the API, for what a page says of it',
  })
  readonly now!: string;

  @ApiProperty({ description: "The practice's IANA time zone, in which to show the times" })
  readonly timeZone!: string;

  @ApiProperty({ description: "The practice's digits, for showing the times" })
  readonly numberingSystem!: string;

  @ApiProperty({ description: "The practice's hour cycle, for showing the times" })
  readonly hourCycle!: string;

  @ApiProperty({ type: DeskDayCountsDto, description: 'Of the whole day, also beyond `items`' })
  readonly counts!: DeskDayCountsDto;

  @ApiProperty({ description: 'Free times of the day from now on, which a patient can book' })
  readonly openTimes!: number;

  @ApiProperty({ format: 'date-time', nullable: true, type: 'string' })
  readonly nextOpenAt!: string | null;

  @ApiProperty({ type: [DeskAppointmentRowDto] })
  readonly items!: readonly DeskAppointmentRowDto[];

  @ApiProperty({ description: 'More appointments than one answer holds: the list stops there' })
  readonly truncated!: boolean;
}

/** What the team needs to reach the patient and to recognise them (W6). */
export class DeskPatientDetailsDto extends DeskPatientDto {
  @ApiProperty({ format: 'date' })
  readonly dateOfBirth!: string;

  @ApiProperty({ description: "Whole years on today's date in the practice" })
  readonly age!: number;

  @ApiProperty({ nullable: true, type: 'string' })
  readonly insuranceProvider!: string | null;

  @ApiProperty({ nullable: true, type: 'string' })
  readonly phone!: string | null;

  @ApiProperty({
    nullable: true,
    type: 'string',
    description: "The address of the patient's account; null for a profile without an account",
  })
  readonly email!: string | null;
}

/**
 * One appointment for the team (W6), with what the patient wrote. Every answer is a read of the
 * patient's record and writes an audit event (BR-18).
 */
export class DeskAppointmentDto extends DeskAppointmentRowDto {
  @ApiProperty({ type: DeskPatientDetailsDto })
  override readonly patient!: DeskPatientDetailsDto;

  @ApiProperty({ format: 'date-time' })
  readonly bookedAt!: string;

  @ApiProperty({
    nullable: true,
    type: 'string',
    description: 'What the patient wrote for the practice when booking (RT-93)',
  })
  readonly patientNote!: string | null;

  @ApiProperty({ nullable: true, type: 'string', description: 'Only for a cancel by the practice' })
  readonly cancelReason!: string | null;

  @ApiProperty({ description: "The practice's IANA time zone, in which to show the times" })
  readonly timeZone!: string;

  @ApiProperty({ description: "The practice's digits, for showing the times" })
  readonly numberingSystem!: string;

  @ApiProperty({ description: "The practice's hour cycle, for showing the times" })
  readonly hourCycle!: string;
}

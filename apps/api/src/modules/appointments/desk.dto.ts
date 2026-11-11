import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CursorQueryDto } from '../../common/http/cursor-page.js';
import { PatientDetailsDto } from '../patients/patients.dto.js';
import { INSTANT, MAX_NOTE_LENGTH, NOTE_TEXT } from './appointments.dto.js';
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

/**
 * W7: a time for a patient of the practice, booked by the team. A time, not a slot, as for a
 * patient's own booking: the API picks a free slot of that time in its transaction.
 */
export class DeskBookingDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  readonly patientId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  readonly serviceId!: string;

  @ApiProperty({ format: 'date-time', pattern: INSTANT.source })
  @IsString()
  @Matches(INSTANT)
  readonly startsAt!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'A doctor of the practice; left out, any doctor free at that time',
  })
  @IsOptional()
  @IsUUID('all')
  readonly providerId?: string;
}

/**
 * W7 "Add patient": a person without an account as a patient of the practice, with what the
 * practice asks of every patient (BR-10). The names, the date of birth and the insurance type are
 * required, which the answer names field by field; a phone, a provider and a number as the
 * practice's rules ask.
 */
export class DeskNewPatientDto extends PatientDetailsDto {
  @ApiPropertyOptional({
    description:
      'Add although a patient with the same name and date of birth, or the same insurance number, exists (PATIENT_MAY_EXIST); audited apart',
  })
  @IsOptional()
  @IsBoolean()
  readonly confirmDuplicate?: boolean;
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

/** The longest search the team types: a name, a phone number, a date or an insurance number. */
const MAX_SEARCH_LENGTH = 100;

/**
 * W5: the appointments of some days, with what the team narrows them to. The body of a POST that
 * only reads: a name or number typed into the search stays out of every URL and its logs
 * (health-data-security; security review of M05).
 */
export class DeskAppointmentSearchDto extends CursorQueryDto {
  @ApiPropertyOptional({
    format: 'date',
    pattern: ISO_DATE.source,
    description: "The first day, on the practice's calendar; left out, today",
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE)
  readonly from?: string;

  @ApiPropertyOptional({
    format: 'date',
    pattern: ISO_DATE.source,
    description: 'The last day, included; left out, six days after the first. At most 92 days',
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE)
  readonly to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  readonly providerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  readonly serviceId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  readonly patientId?: string;

  @ApiPropertyOptional({ enum: APPOINTMENT_STATUSES })
  @IsOptional()
  @IsIn(APPOINTMENT_STATUSES)
  readonly status?: AppointmentStatusName;

  @ApiPropertyOptional({
    maxLength: MAX_SEARCH_LENGTH,
    description: 'A patient by name, phone number, date of birth or insurance number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
  readonly query?: string;
}

export class DeskAppointmentPageDto {
  @ApiProperty({ type: [DeskAppointmentRowDto] })
  readonly items!: readonly DeskAppointmentRowDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Null on the last page' })
  readonly nextCursor!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'How many appointments the whole list holds; only on the first page, null after a cursor',
  })
  readonly total!: number | null;

  @ApiProperty({ format: 'date' })
  readonly from!: string;

  @ApiProperty({ format: 'date' })
  readonly to!: string;

  @ApiProperty({ format: 'date', description: "Today on the practice's calendar" })
  readonly today!: string;

  @ApiProperty({ description: "The practice's IANA time zone, in which to show the times" })
  readonly timeZone!: string;

  @ApiProperty({ description: "The practice's digits, for showing the times" })
  readonly numberingSystem!: string;

  @ApiProperty({ description: "The practice's hour cycle, for showing the times" })
  readonly hourCycle!: string;
}

/** W8: the patients of the practice, found as the team types; a body, as W5's (see there). */
export class DeskPatientSearchDto extends CursorQueryDto {
  @ApiPropertyOptional({
    maxLength: MAX_SEARCH_LENGTH,
    description:
      'A name in Arabic or Latin letters however written, digits of a phone number, a date of birth or an insurance number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
  readonly query?: string;

  @ApiPropertyOptional({ enum: INSURANCE_TYPES })
  @IsOptional()
  @IsIn(INSURANCE_TYPES)
  readonly insuranceType?: (typeof INSURANCE_TYPES)[number];
}

/** A patient as a row of W8 shows them. */
export class DeskPatientRowDto extends DeskPatientDto {
  @ApiProperty({ format: 'date' })
  readonly dateOfBirth!: string;

  @ApiProperty({ description: "Whole years on today's date in the practice" })
  readonly age!: number;

  @ApiProperty({ nullable: true, type: 'string' })
  readonly phone!: string | null;

  @ApiProperty({ nullable: true, type: 'string' })
  readonly insuranceProvider!: string | null;

  @ApiProperty({
    description: 'The profile belongs to an account; false for one the practice keeps',
  })
  readonly hasAccount!: boolean;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    type: 'string',
    description: 'The start of the last visit that took place (checked in or completed)',
  })
  readonly lastVisitAt!: string | null;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    type: 'string',
    description: 'The start of the next booked appointment',
  })
  readonly nextAppointmentAt!: string | null;
}

export class DeskPatientPageDto {
  @ApiProperty({ type: [DeskPatientRowDto] })
  readonly items!: readonly DeskPatientRowDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Null on the last page' })
  readonly nextCursor!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'How many patients the whole list holds; only on the first page, null after a cursor',
  })
  readonly total!: number | null;

  @ApiProperty({ description: "The practice's IANA time zone, in which to show the times" })
  readonly timeZone!: string;

  @ApiProperty({ description: "The practice's digits, for showing the times" })
  readonly numberingSystem!: string;

  @ApiProperty({ description: "The practice's hour cycle, for showing the times" })
  readonly hourCycle!: string;
}

/** One patient for the team, with what is to come and what was (W8); the read is audited. */
export class DeskPatientRecordDto {
  @ApiProperty({ type: DeskPatientDetailsDto })
  readonly patient!: DeskPatientDetailsDto;

  @ApiProperty({
    nullable: true,
    type: 'string',
    description: 'The last characters of the insurance number, never the number itself',
  })
  readonly insuranceNumberEnd!: string | null;

  @ApiProperty({
    type: [DeskAppointmentRowDto],
    description: 'What is still to come, soonest first',
  })
  readonly upcoming!: readonly DeskAppointmentRowDto[];

  @ApiProperty({
    type: [DeskAppointmentRowDto],
    description: 'The last appointments, latest first',
  })
  readonly recent!: readonly DeskAppointmentRowDto[];

  @ApiProperty({ description: "The practice's IANA time zone, in which to show the times" })
  readonly timeZone!: string;

  @ApiProperty({ description: "The practice's digits, for showing the times" })
  readonly numberingSystem!: string;

  @ApiProperty({ description: "The practice's hour cycle, for showing the times" })
  readonly hourCycle!: string;
}

export class DeskProviderDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly name!: string;
}

export class DeskServiceDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'The name of the service per locale',
  })
  readonly name!: Readonly<Record<string, string>>;

  @ApiProperty()
  readonly durationMinutes!: number;

  @ApiProperty({ description: 'Offered now; an inactive one still names old appointments' })
  readonly active!: boolean;

  @ApiProperty({ description: 'Patients bring a referral letter (BR-26)' })
  readonly referralRequired!: boolean;
}

/** What the practice asks of a patient's insurance (BR-10), for a patient the team adds (W7). */
export class DeskInsuranceRulesDto {
  @ApiProperty({
    enum: INSURANCE_TYPES,
    isArray: true,
    description: 'The types the practice takes',
  })
  readonly types!: readonly (typeof INSURANCE_TYPES)[number][];

  @ApiProperty({
    enum: INSURANCE_TYPES,
    isArray: true,
    description: 'The types that need a provider',
  })
  readonly providerTypes!: readonly (typeof INSURANCE_TYPES)[number][];

  @ApiProperty({
    enum: INSURANCE_TYPES,
    isArray: true,
    description: 'The types that need a number',
  })
  readonly numberTypes!: readonly (typeof INSURANCE_TYPES)[number][];
}

/** What the team chooses from: the doctors and the services of the practice, and its insurance rules. */
export class DeskCatalogDto {
  @ApiProperty({ type: [DeskProviderDto] })
  readonly providers!: readonly DeskProviderDto[];

  @ApiProperty({ type: [DeskServiceDto] })
  readonly services!: readonly DeskServiceDto[];

  @ApiProperty({ type: DeskInsuranceRulesDto })
  readonly insurance!: DeskInsuranceRulesDto;
}

const SLOT_STATUSES = ['OPEN', 'BOOKED', 'BLOCKED'] as const;
const ABSENCE_REASONS = ['VACATION', 'HOLIDAY', 'TRAINING', 'OTHER'] as const;

/** W2: the week of one doctor. */
export class DeskWeekQueryDto {
  @ApiProperty({ format: 'uuid', description: 'The doctor whose week the calendar shows' })
  @IsUUID('all')
  readonly providerId!: string;

  @ApiPropertyOptional({
    format: 'date',
    pattern: ISO_DATE.source,
    description: "The first of seven days, on the practice's calendar; left out, today",
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE)
  readonly from?: string;
}

/** The patient as the calendar names them. */
export class DeskWeekPatientDto {
  @ApiProperty()
  readonly firstName!: string;

  @ApiProperty()
  readonly lastName!: string;
}

/**
 * What the calendar shows of an appointment and no more (data minimisation, security review of
 * M05): who, what and its status. Its details, with what the team may do, come from W6 by its id.
 */
export class DeskWeekAppointmentDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ type: DeskWeekPatientDto })
  readonly patient!: DeskWeekPatientDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'The name of the service per locale',
  })
  readonly serviceName!: Readonly<Record<string, string>>;

  @ApiProperty({ enum: APPOINTMENT_STATUSES })
  readonly status!: AppointmentStatusName;
}

/** A time of the doctor's week, and the appointment that holds it. */
export class DeskWeekSlotDto {
  @ApiProperty({ format: 'uuid', description: 'For blocking or freeing the time (M04)' })
  readonly id!: string;

  @ApiProperty({ format: 'date-time' })
  readonly startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  readonly endsAt!: string;

  @ApiProperty({
    enum: SLOT_STATUSES,
    description: 'OPEN: free, also again after a cancel; BOOKED: held; BLOCKED: closed by the team',
  })
  readonly status!: (typeof SLOT_STATUSES)[number];

  @ApiProperty({
    type: DeskWeekAppointmentDto,
    nullable: true,
    description: 'The appointment that holds the time; a cancelled one holds none',
  })
  readonly appointment!: DeskWeekAppointmentDto | null;
}

/** A time the doctor is away, in which no slot exists. */
export class DeskAbsenceDto {
  @ApiProperty({ format: 'date-time' })
  readonly startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  readonly endsAt!: string;

  @ApiProperty({ enum: ABSENCE_REASONS })
  readonly reason!: (typeof ABSENCE_REASONS)[number];
}

/** W2: seven days of one doctor, in the order of time. */
export class DeskWeekDto {
  @ApiProperty({ format: 'date' })
  readonly from!: string;

  @ApiProperty({ format: 'date' })
  readonly to!: string;

  @ApiProperty({ format: 'date', description: "Today on the practice's calendar" })
  readonly today!: string;

  @ApiProperty({
    format: 'date-time',
    description: "The API's now, so that the web reads no clock",
  })
  readonly now!: string;

  @ApiProperty({ format: 'uuid' })
  readonly providerId!: string;

  @ApiProperty({ type: [DeskWeekSlotDto] })
  readonly slots!: readonly DeskWeekSlotDto[];

  @ApiProperty({ type: [DeskAbsenceDto] })
  readonly absences!: readonly DeskAbsenceDto[];

  @ApiProperty({
    description: 'More times than one answer holds: the calendar shows the first ones',
  })
  readonly truncated!: boolean;

  @ApiProperty({ description: "The practice's IANA time zone, in which to show the times" })
  readonly timeZone!: string;

  @ApiProperty({ description: "The practice's digits, for showing the times" })
  readonly numberingSystem!: string;

  @ApiProperty({ description: "The practice's hour cycle, for showing the times" })
  readonly hourCycle!: string;
}

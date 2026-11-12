import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception.js';
import { FIELD_ERROR_MESSAGES } from '../../common/errors/field-error-codes.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { Clock } from '../../common/time/clock.js';
import { instantOf } from '../../common/time/convert.js';
import type { Prisma } from '../../generated/practice/client.js';
import type { DeskAppointmentRowDto } from './desk.dto.js';
import { dayRelationOf, deskActionsOf, type DeskTiming } from './domain/desk.rules.js';

/**
 * A list read again by the same person within these minutes adds no audit rows for the appointments
 * or patients it showed before: a page refreshes on focus and after every change (BR-18 keeps who
 * saw what).
 */
export const LIST_AUDIT_MINUTES = 5;

/** The audit actions of the team's reads and changes of appointments (BR-12, BR-18). */
export const DESK_AUDIT = {
  list: 'appointment.list',
  read: 'appointment.read',
  CHECK_IN: 'appointment.check_in',
  COMPLETE: 'appointment.complete',
  NO_SHOW: 'appointment.no_show',
  CANCEL: 'appointment.cancel_by_practice',
  /** Part of a patient's copy of their data (Art. 15, RT-97). */
  export: 'appointment.export',
} as const;

/** What a row of the desk reads of an appointment: never the note, never a reason. */
export const ROW_FIELDS = {
  id: true,
  serviceId: true,
  status: true,
  bookedById: true,
  checkedInAt: true,
  completedAt: true,
  cancelledAt: true,
  cancelReasonEncrypted: true,
  patient: {
    select: { id: true, userId: true, firstName: true, lastName: true, insuranceType: true },
  },
  endsAt: true,
  service: { select: { name: true, durationMinutes: true } },
  slot: { select: { providerId: true, startsAt: true } },
} as const;

export type DeskRow = Prisma.AppointmentGetPayload<{ select: typeof ROW_FIELDS }>;

/** The answer's shape as a plain object type, so that a detail can spread it. */
export type RowView = Pick<DeskAppointmentRowDto, keyof DeskAppointmentRowDto>;

const DISPLAY_SETTINGS = { timeZone: true, numberingSystem: true, hourCycle: true } as const;

export type DisplaySettings = Prisma.PracticeSettingsGetPayload<{
  select: typeof DISPLAY_SETTINGS;
}>;

export function displayNameOf(member: {
  readonly title: string | null;
  readonly firstName: string;
  readonly lastName: string;
}): string {
  return [member.title, member.firstName, member.lastName]
    .filter((part) => part !== null && part !== '')
    .join(' ');
}

export function iso(date: Date | null): string | null {
  return date === null ? null : instantOf(date).toString();
}

/** The years a day of the desk can lie in: the database has no year 0, and no practice needs 9999. */
const FIRST_YEAR = 1900;
const LAST_YEAR = 2199;

/**
 * A date of the query string; 2026-02-31 has the right form and is no day, and a year far off is
 * no day of a practice either (security review of M05): both are answered like any other.
 */
export function dateOfInput(value: string, field: string): Temporal.PlainDate {
  const refused = (): DomainException =>
    new DomainException('VALIDATION_FAILED', {
      fieldErrors: [{ field, code: 'INVALID_VALUE', message: FIELD_ERROR_MESSAGES.INVALID_VALUE }],
    });
  let date: Temporal.PlainDate;
  try {
    date = Temporal.PlainDate.from(value, { overflow: 'reject' });
  } catch {
    throw refused();
  }
  if (date.year < FIRST_YEAR || date.year > LAST_YEAR) throw refused();
  return date;
}

/** How the desk shows an appointment in a row, the same in every list of the team (M05). */
@Injectable()
export class DeskRows {
  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly clock: Clock,
  ) {}

  displaySettings(): Promise<DisplaySettings> {
    return this.txHost.tx.practiceSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: DISPLAY_SETTINGS,
    });
  }

  /** Rows with their doctors read once, at one moment of the clock. */
  async viewsOf(rows: readonly DeskRow[], timeZone: string): Promise<RowView[]> {
    const names = await this.namesOf(rows);
    const now = this.clock.now();
    return rows.map((row) => this.viewOf(row, names, now, timeZone));
  }

  /** Every doctor of the rows, named for the team with or without a public profile, read once. */
  async namesOf(rows: readonly DeskRow[]): Promise<ReadonlyMap<string, string>> {
    if (rows.length === 0) return new Map();
    const members = await this.txHost.tx.staffMember.findMany({
      where: { id: { in: [...new Set(rows.map(({ slot }) => slot.providerId))] } },
      select: { id: true, title: true, firstName: true, lastName: true },
    });
    return new Map(members.map((member) => [member.id, displayNameOf(member)]));
  }

  viewOf(
    row: DeskRow,
    names: ReadonlyMap<string, string>,
    now: Temporal.Instant,
    timeZone: string,
  ): RowView {
    const startsAt = instantOf(row.slot.startsAt);
    const timing: DeskTiming = { now, startsAt, timeZone };
    return {
      id: row.id,
      patient: {
        id: row.patient.id,
        firstName: row.patient.firstName,
        lastName: row.patient.lastName,
        insuranceType: row.patient.insuranceType,
      },
      serviceId: row.serviceId,
      serviceName: row.service.name as Readonly<Record<string, string>>,
      durationMinutes: row.service.durationMinutes,
      providerId: row.slot.providerId,
      providerName: names.get(row.slot.providerId) ?? '',
      startsAt: startsAt.toString(),
      endsAt: instantOf(row.endsAt).toString(),
      status: row.status,
      bookedOnline: row.patient.userId !== null && row.bookedById === row.patient.userId,
      checkedInAt: iso(row.checkedInAt),
      completedAt: iso(row.completedAt),
      cancelledAt: iso(row.cancelledAt),
      cancelledByPractice: row.status === 'CANCELLED' && row.cancelReasonEncrypted !== null,
      day: dayRelationOf(timing),
      started: Temporal.Instant.compare(now, startsAt) >= 0,
      actions: deskActionsOf(row.status, timing),
    };
  }
}

import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context.js';
import { isUuid } from '../../common/context/request-id.js';
import { PlatformPrismaService } from '../../common/database/platform-prisma.service.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { FIELD_ERROR_MESSAGES } from '../../common/errors/field-error-codes.js';
import type { Actor } from '../../common/security/actor.js';
import { AccountTransactions } from '../../common/tenancy/account-transactions.js';
import { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import { requirePracticeContext } from '../../common/tenancy/practice-context.js';
import { PracticeKeys } from '../../common/tenancy/practice-keys.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf, instantOf, plainDateOf } from '../../common/time/convert.js';
import type { Prisma } from '../../generated/practice/client.js';
import { dayRange } from '../scheduling/domain/slots.rules.js';
import { cancelReasonContextOf, noteContextOf } from './appointment-texts.js';
import type {
  DeskAppointmentDto,
  DeskAppointmentRowDto,
  DeskDayDto,
  DeskDayQueryDto,
} from './desk.dto.js';
import {
  ageOn,
  type AppointmentStatusName,
  dayOf,
  dayRelationOf,
  type DeskAction,
  deskActionsOf,
  deskChangeOf,
  type DeskTiming,
} from './domain/desk.rules.js';

/** More than a day of a practice holds; the list of the day stops there and says so. */
export const DESK_DAY_LIMIT = 500;

/**
 * A list read again by the same person within these minutes adds no audit rows for the appointments
 * it showed before: a page refreshes on focus and after every change (BR-18 keeps who saw what).
 */
export const LIST_AUDIT_MINUTES = 5;

/** The audit actions of the team's reads and changes (BR-12, BR-18). */
export const DESK_AUDIT = {
  list: 'appointment.list',
  read: 'appointment.read',
  CHECK_IN: 'appointment.check_in',
  COMPLETE: 'appointment.complete',
  NO_SHOW: 'appointment.no_show',
  CANCEL: 'appointment.cancel_by_practice',
} as const;

const ROW_FIELDS = {
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
  service: { select: { name: true, durationMinutes: true } },
  slot: { select: { providerId: true, startsAt: true, endsAt: true } },
} as const;

type Row = Prisma.AppointmentGetPayload<{ select: typeof ROW_FIELDS }>;

const DETAIL_FIELDS = {
  ...ROW_FIELDS,
  bookedAt: true,
  patientNoteEncrypted: true,
  patient: {
    select: {
      ...ROW_FIELDS.patient.select,
      dateOfBirth: true,
      insuranceProvider: true,
      contactPhone: true,
    },
  },
} as const;

type DetailRow = Prisma.AppointmentGetPayload<{ select: typeof DETAIL_FIELDS }>;

/** The answer's shape as a plain object type, so that a detail can spread it. */
type RowView = Pick<DeskAppointmentRowDto, keyof DeskAppointmentRowDto>;

const DISPLAY_SETTINGS = { timeZone: true, numberingSystem: true, hourCycle: true } as const;

type DisplaySettings = Prisma.PracticeSettingsGetPayload<{ select: typeof DISPLAY_SETTINGS }>;

/** A change of the team; a cancel carries its reason, sealed before the transaction. */
type Change =
  | { readonly action: Exclude<DeskAction, 'CANCEL'> }
  | { readonly action: 'CANCEL'; readonly sealedReason: string };

function invalidDate(): DomainException {
  return new DomainException('VALIDATION_FAILED', {
    fieldErrors: [
      { field: 'date', code: 'INVALID_VALUE', message: FIELD_ERROR_MESSAGES.INVALID_VALUE },
    ],
  });
}

function dateOfInput(value: string): Temporal.PlainDate {
  try {
    return Temporal.PlainDate.from(value, { overflow: 'reject' });
  } catch {
    // 2026-02-31 has the right form and is no day: answered like any other.
    throw invalidDate();
  }
}

function displayNameOf(member: {
  readonly title: string | null;
  readonly firstName: string;
  readonly lastName: string;
}): string {
  return [member.title, member.firstName, member.lastName]
    .filter((part) => part !== null && part !== '')
    .join(' ');
}

function iso(date: Date | null): string | null {
  return date === null ? null : instantOf(date).toString();
}

/**
 * The practice's side of its appointments (M05): the day of the team (W1), one appointment with what
 * the patient wrote (W6), and the changes of BR-04 and BR-11. Every read writes an audit event per
 * appointment it shows (BR-18), every change one for itself (BR-12), in its transaction. A change
 * waits for the patient's row, as everything that changes a person's appointments does, and a retry
 * of a change that is there already answers alike.
 */
@Injectable()
export class DeskService {
  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly platform: PlatformPrismaService,
    private readonly transactions: AccountTransactions,
    private readonly cls: ClsService<RequestContext>,
    private readonly clock: Clock,
    private readonly keys: PracticeKeys,
    private readonly audit: PracticeAudit,
  ) {}

  async day(
    { userId }: Actor,
    { date }: DeskDayQueryDto,
    ip: string | undefined,
  ): Promise<DeskDayDto> {
    const { practice } = requirePracticeContext(this.cls);
    const settings = await this.displaySettings();
    const now = this.clock.now();
    const today = dayOf(now, settings.timeZone);
    const day = date === undefined ? today : dateOfInput(date);
    const { start, end } = dayRange(day, settings.timeZone);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    const db = this.txHost.tx;
    const ofDay: Prisma.AppointmentWhereInput = {
      slot: { startsAt: { gte: dbInstantOf(start), lt: dbInstantOf(end) } },
    };
    const found = await db.appointment.findMany({
      where: ofDay,
      select: ROW_FIELDS,
      orderBy: [{ slot: { startsAt: 'asc' } }, { id: 'asc' }],
      take: DESK_DAY_LIMIT + 1,
    });
    const rows = found.slice(0, DESK_DAY_LIMIT);
    const byStatus = await db.appointment.groupBy({
      by: ['status'],
      where: ofDay,
      _count: { _all: true },
    });
    const countOf = (status: AppointmentStatusName): number =>
      byStatus.find((group) => group.status === status)?._count._all ?? 0;
    // Free times still to come: an OPEN slot without a rule holds history, not a time to book.
    const from = Temporal.Instant.compare(now, start) > 0 ? now : start;
    const free: Prisma.SlotWhereInput = {
      status: 'OPEN',
      ruleId: { not: null },
      startsAt: { gte: dbInstantOf(from), lt: dbInstantOf(end) },
    };
    const openTimes = await db.slot.count({ where: free });
    const next = await db.slot.findFirst({
      where: free,
      select: { startsAt: true },
      orderBy: { startsAt: 'asc' },
    });
    const names = await this.namesOf(rows);
    await this.audit.recordEachUnlessRecent({
      userId,
      action: DESK_AUDIT.list,
      subjectIds: rows.map(({ id }) => id),
      ipHash,
      minutes: LIST_AUDIT_MINUTES,
    });
    return {
      date: day.toString(),
      today: today.toString(),
      now: now.toString(),
      ...settings,
      counts: {
        booked: countOf('BOOKED'),
        checkedIn: countOf('CHECKED_IN'),
        completed: countOf('COMPLETED'),
        noShow: countOf('NO_SHOW'),
        cancelled: countOf('CANCELLED'),
      },
      openTimes,
      nextOpenAt: iso(next?.startsAt ?? null),
      items: rows.map((row) => this.viewOf(row, names, now, settings.timeZone)),
      truncated: found.length > DESK_DAY_LIMIT,
    };
  }

  /** W6: one appointment, with what the patient wrote and how to reach them. */
  async appointment(
    { userId }: Actor,
    appointmentId: string,
    ip: string | undefined,
  ): Promise<DeskAppointmentDto> {
    const id = this.idOf(appointmentId);
    const { practice } = requirePracticeContext(this.cls);
    const row = await this.txHost.tx.appointment.findUnique({
      where: { id },
      select: DETAIL_FIELDS,
    });
    if (row === null) throw new DomainException('NOT_FOUND');
    const settings = await this.displaySettings();
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    const view = this.viewOf(row, await this.namesOf([row]), this.clock.now(), settings.timeZone);
    const details = await this.detailsOf(practice.id, row, settings);
    await this.audit.record({ userId, action: DESK_AUDIT.read, subjectId: id, ipHash });
    return { ...view, ...details };
  }

  async change(
    actor: Actor,
    appointmentId: string,
    action: Exclude<DeskAction, 'CANCEL'>,
    ip: string | undefined,
  ): Promise<DeskAppointmentRowDto> {
    return this.apply(actor, this.idOf(appointmentId), { action }, ip);
  }

  /** BR-04: the practice can always cancel a booked appointment, with a reason the team keeps. */
  async cancel(
    actor: Actor,
    appointmentId: string,
    reason: string,
    ip: string | undefined,
  ): Promise<DeskAppointmentRowDto> {
    const id = this.idOf(appointmentId);
    const { practice } = requirePracticeContext(this.cls);
    // Before the transaction, because reading a key should not hold a lock.
    const sealedReason = await this.keys.encrypt(practice.id, reason, cancelReasonContextOf(id));
    return this.apply(actor, id, { action: 'CANCEL', sealedReason }, ip);
  }

  private idOf(appointmentId: string): string {
    if (!isUuid(appointmentId)) throw new DomainException('NOT_FOUND');
    return appointmentId.toLowerCase();
  }

  private async apply(
    { userId }: Actor,
    id: string,
    change: Change,
    ip: string | undefined,
  ): Promise<DeskAppointmentRowDto> {
    const { practice } = requirePracticeContext(this.cls);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    const settings = await this.displaySettings();
    return this.transactions.run(userId, async () => {
      const db = this.txHost.tx;
      // The patient of an appointment never changes: their row is the lock to take first.
      const target = await db.appointment.findUnique({
        where: { id },
        select: { patientId: true },
      });
      if (target === null) throw new DomainException('NOT_FOUND');
      await db.$queryRaw`SELECT 1 FROM patients WHERE id = ${target.patientId}::uuid FOR UPDATE`;
      const row = await db.appointment.findUniqueOrThrow({
        where: { id },
        select: {
          status: true,
          slotId: true,
          cancelReasonEncrypted: true,
          slot: { select: { startsAt: true } },
        },
      });
      const now = this.clock.now();
      const timing: DeskTiming = {
        now,
        startsAt: instantOf(row.slot.startsAt),
        timeZone: settings.timeZone,
      };
      const outcome = deskChangeOf(change.action, row.status, timing);
      // Cancelled by the patient, or moved by them a moment ago: the team's cancel did not happen,
      // and the team must not tell the patient that it did.
      const byPatient =
        change.action === 'CANCEL' && outcome.kind === 'same' && row.cancelReasonEncrypted === null;
      if (outcome.kind === 'invalid' || byPatient) {
        throw new DomainException('INVALID_STATUS_TRANSITION');
      }
      await this.audit.record({
        userId,
        // A retry shows the row as a list does, and is audited as one (BR-18).
        action: outcome.kind === 'apply' ? DESK_AUDIT[change.action] : DESK_AUDIT.list,
        subjectId: id,
        ipHash,
      });
      if (outcome.kind === 'apply') await this.write(id, row.slotId, change, userId, now);
      const written = await db.appointment.findUniqueOrThrow({ where: { id }, select: ROW_FIELDS });
      return this.viewOf(written, await this.namesOf([written]), now, settings.timeZone);
    });
  }

  private async write(
    id: string,
    slotId: string,
    change: Change,
    userId: string,
    now: Temporal.Instant,
  ): Promise<void> {
    const db = this.txHost.tx;
    const at = dbInstantOf(now);
    switch (change.action) {
      case 'CHECK_IN': {
        await db.appointment.update({
          where: { id },
          data: { status: 'CHECKED_IN', checkedInAt: at },
        });
        return;
      }
      case 'COMPLETE': {
        await db.appointment.update({
          where: { id },
          data: { status: 'COMPLETED', completedAt: at },
        });
        return;
      }
      case 'NO_SHOW': {
        await db.appointment.update({ where: { id }, data: { status: 'NO_SHOW' } });
        return;
      }
      case 'CANCEL': {
        await db.appointment.update({
          where: { id },
          data: {
            status: 'CANCELLED',
            cancelledAt: at,
            cancelledById: userId,
            cancelReasonEncrypted: change.sealedReason,
          },
        });
        // The time is free for others again (BR-07); the note stays with the appointment.
        await db.slot.updateMany({
          where: { id: slotId, status: 'BOOKED' },
          data: { status: 'OPEN' },
        });
        return;
      }
    }
  }

  private displaySettings(): Promise<DisplaySettings> {
    return this.txHost.tx.practiceSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: DISPLAY_SETTINGS,
    });
  }

  /** Every doctor of the rows, named for the team with or without a public profile, read once. */
  private async namesOf(rows: readonly Row[]): Promise<ReadonlyMap<string, string>> {
    if (rows.length === 0) return new Map();
    const members = await this.txHost.tx.staffMember.findMany({
      where: { id: { in: [...new Set(rows.map(({ slot }) => slot.providerId))] } },
      select: { id: true, title: true, firstName: true, lastName: true },
    });
    return new Map(members.map((member) => [member.id, displayNameOf(member)]));
  }

  private viewOf(
    row: Row,
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
      endsAt: instantOf(row.slot.endsAt).toString(),
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

  private async detailsOf(
    practiceId: string,
    row: DetailRow,
    settings: DisplaySettings,
  ): Promise<
    Omit<DeskAppointmentDto, keyof DeskAppointmentRowDto> & Pick<DeskAppointmentDto, 'patient'>
  > {
    const { patient } = row;
    const account =
      patient.userId === null
        ? null
        : await this.platform.user.findUnique({
            where: { id: patient.userId },
            select: { email: true },
          });
    const dateOfBirth = plainDateOf(patient.dateOfBirth);
    return {
      patient: {
        id: patient.id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        insuranceType: patient.insuranceType,
        dateOfBirth: dateOfBirth.toString(),
        age: ageOn(dateOfBirth, dayOf(this.clock.now(), settings.timeZone)),
        insuranceProvider: patient.insuranceProvider,
        phone: patient.contactPhone,
        email: account?.email ?? null,
      },
      bookedAt: instantOf(row.bookedAt).toString(),
      patientNote:
        row.patientNoteEncrypted === null
          ? null
          : await this.keys.decrypt(practiceId, row.patientNoteEncrypted, noteContextOf(row.id)),
      cancelReason:
        row.cancelReasonEncrypted === null
          ? null
          : await this.keys.decrypt(
              practiceId,
              row.cancelReasonEncrypted,
              cancelReasonContextOf(row.id),
            ),
      ...settings,
    };
  }
}

import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context.js';
import { isUuid } from '../../common/context/request-id.js';
import { PlatformPrismaService } from '../../common/database/platform-prisma.service.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { FIELD_ERROR_MESSAGES } from '../../common/errors/field-error-codes.js';
import { cursorPageOf, decodeCursor, invalidCursor } from '../../common/http/cursor-page.js';
import type { Actor } from '../../common/security/actor.js';
import { AccountTransactions } from '../../common/tenancy/account-transactions.js';
import { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import { requirePracticeContext } from '../../common/tenancy/practice-context.js';
import { PracticeKeys } from '../../common/tenancy/practice-keys.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf, instantOf, plainDateOf } from '../../common/time/convert.js';
import { Prisma } from '../../generated/practice/client.js';
import {
  INSURANCE_TYPES,
  type InsuranceTypeName,
} from '../account-profile/domain/profile.rules.js';
import { dayRange } from '../scheduling/domain/slots.rules.js';
import { cancelReasonContextOf, noteContextOf } from './appointment-texts.js';
import { AppointmentsService } from './appointments.service.js';
import { DeskPatients } from './desk-patients.js';
import {
  dateOfInput,
  DESK_AUDIT,
  DeskRows,
  type DisplaySettings,
  displayNameOf,
  iso,
  LIST_AUDIT_MINUTES,
  ROW_FIELDS,
} from './desk-rows.js';
import type {
  DeskAppointmentDto,
  DeskAppointmentPageDto,
  DeskAppointmentRowDto,
  DeskAppointmentSearchDto,
  DeskBookingDto,
  DeskCatalogDto,
  DeskDayDto,
  DeskDayQueryDto,
  DeskWeekDto,
  DeskWeekQueryDto,
} from './desk.dto.js';
import {
  ageOn,
  type AppointmentStatusName,
  dayOf,
  type DeskAction,
  deskChangeOf,
  type DeskTiming,
} from './domain/desk.rules.js';
import { patientSearchOf } from './domain/patient-search.rules.js';

/** A type of insurance the API knows, of the text[] the practice's settings keep. */
function isInsuranceType(value: string): value is InsuranceTypeName {
  return (INSURANCE_TYPES as readonly string[]).includes(value);
}

/** The appointments of W5 with their slot and patient, which its conditions name as `s` and `p`. */
const LIST_SOURCE = Prisma.sql`appointments a
  JOIN slots s ON s.id = a.slot_id
  JOIN patients p ON p.id = a.patient_id`;

/** More than a day of a practice holds; the list of the day stops there and says so. */
export const DESK_DAY_LIMIT = 500;

/** The days of the calendar's week (W2). */
const WEEK_DAYS = 7;

/**
 * More slots than a doctor's week holds today, with slots of five minutes and a clock change; the
 * calendar stops there and says so, as the day does (security review of M05).
 */
export const WEEK_SLOT_LIMIT = 2100;

/** What the calendar reads of an appointment: who, what, and its status. */
const WEEK_APPOINTMENT_FIELDS = {
  id: true,
  status: true,
  patient: { select: { firstName: true, lastName: true } },
  service: { select: { name: true } },
} as const;

/** The longest span of days one list of appointments covers (W5). */
export const MAX_LIST_DAYS = 92;

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

/** A change of the team; a cancel carries its reason, sealed before the transaction. */
type Change =
  | { readonly action: Exclude<DeskAction, 'CANCEL'> }
  | { readonly action: 'CANCEL'; readonly sealedReason: string };

function tooLong(): DomainException {
  return new DomainException('VALIDATION_FAILED', {
    fieldErrors: [
      { field: 'to', code: 'INVALID_VALUE', message: FIELD_ERROR_MESSAGES.INVALID_VALUE },
    ],
  });
}

/**
 * The practice's side of its appointments (M05): the day of the team (W1), the list of some days
 * (W5), one appointment with what the patient wrote (W6), and the changes of BR-04 and BR-11. Every
 * read writes an audit event per appointment it shows (BR-18), every change one for itself (BR-12),
 * in its transaction. A change waits for the patient's row, as everything that changes a person's
 * appointments does, and a retry of a change that is there already answers alike.
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
    private readonly rows: DeskRows,
    private readonly patients: DeskPatients,
    private readonly appointments: AppointmentsService,
  ) {}

  async day(
    { userId }: Actor,
    { date }: DeskDayQueryDto,
    ip: string | undefined,
  ): Promise<DeskDayDto> {
    const { practice } = requirePracticeContext(this.cls);
    const settings = await this.rows.displaySettings();
    const now = this.clock.now();
    const today = dayOf(now, settings.timeZone);
    const day = date === undefined ? today : dateOfInput(date, 'date');
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
    const shown = found.slice(0, DESK_DAY_LIMIT);
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
    const names = await this.rows.namesOf(shown);
    await this.audit.recordEachUnlessRecent({
      userId,
      action: DESK_AUDIT.list,
      subjectIds: shown.map(({ id }) => id),
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
      items: shown.map((row) => this.rows.viewOf(row, names, now, settings.timeZone)),
      truncated: found.length > DESK_DAY_LIMIT,
    };
  }

  /**
   * W5: the appointments of some days in the order of time, narrowed as the team chooses. The
   * patients a search finds are a condition of the same query, so however many there are, none is
   * left out.
   */
  async list(
    { userId }: Actor,
    search: DeskAppointmentSearchDto,
    ip: string | undefined,
  ): Promise<DeskAppointmentPageDto> {
    const { practice } = requirePracticeContext(this.cls);
    const settings = await this.rows.displaySettings();
    const today = dayOf(this.clock.now(), settings.timeZone);
    const from = search.from === undefined ? today : dateOfInput(search.from, 'from');
    const to = search.to === undefined ? from.add({ days: 6 }) : dateOfInput(search.to, 'to');
    const span = from.until(to, { largestUnit: 'days' }).days;
    if (span < 0 || span >= MAX_LIST_DAYS) throw tooLong();
    const patient = search.query === undefined ? undefined : patientSearchOf(search.query);
    const where = Prisma.join(
      [
        Prisma.sql`s.starts_at >= ${dbInstantOf(dayRange(from, settings.timeZone).start)}`,
        Prisma.sql`s.starts_at < ${dbInstantOf(dayRange(to, settings.timeZone).end)}`,
        ...(search.providerId === undefined
          ? []
          : [Prisma.sql`s.provider_id = ${search.providerId.toLowerCase()}::uuid`]),
        ...(search.serviceId === undefined
          ? []
          : [Prisma.sql`a.service_id = ${search.serviceId.toLowerCase()}::uuid`]),
        ...(search.patientId === undefined
          ? []
          : [Prisma.sql`a.patient_id = ${search.patientId.toLowerCase()}::uuid`]),
        ...(search.status === undefined
          ? []
          : [Prisma.sql`a.status = ${search.status}::appointment_status`]),
        ...(patient === undefined ? [] : [await this.patients.conditionOf(patient)]),
      ],
      ' AND ',
    );
    const db = this.txHost.tx;
    const after =
      search.cursor === undefined ? Prisma.sql`TRUE` : await this.afterPosition(search.cursor);
    const ids = await db.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM ${LIST_SOURCE}
      WHERE ${where} AND ${after}
      ORDER BY s.starts_at, a.id
      LIMIT ${search.limit + 1}`;
    const rows = new Map(
      (
        await db.appointment.findMany({
          where: { id: { in: ids.map(({ id }) => id) } },
          select: ROW_FIELDS,
        })
      ).map((row) => [row.id, row]),
    );
    const page = cursorPageOf(
      ids.flatMap(({ id }) => rows.get(id) ?? []),
      search.limit,
      ({ id }) => id,
    );
    // Only the first page counts: a count after a cursor past the end would tell how many
    // appointments match without showing one, and so without an audit row (security review).
    const total =
      search.cursor === undefined
        ? Number(
            (
              await db.$queryRaw<{ total: bigint }[]>`
                SELECT count(*) AS total FROM ${LIST_SOURCE} WHERE ${where}`
            )[0]?.total ?? 0,
          )
        : null;
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    await this.audit.recordEachUnlessRecent({
      userId,
      action: DESK_AUDIT.list,
      subjectIds: page.items.map(({ id }) => id),
      ipHash,
      minutes: LIST_AUDIT_MINUTES,
    });
    return {
      items: await this.rows.viewsOf(page.items, settings.timeZone),
      nextCursor: page.nextCursor,
      total,
      from: from.toString(),
      to: to.toString(),
      today: today.toString(),
      ...settings,
    };
  }

  /** What the team chooses from in its filters and, with W7, when booking: doctors and services. */
  async catalog(): Promise<DeskCatalogDto> {
    const db = this.txHost.tx;
    const providers = await db.staffMember.findMany({
      where: { isProvider: true },
      select: { id: true, title: true, firstName: true, lastName: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
    });
    const services = await db.service.findMany({
      select: { id: true, name: true, durationMinutes: true, active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const rules = await db.practiceSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: { insuranceTypes: true, insuranceProviderTypes: true, insuranceNumberTypes: true },
    });
    return {
      providers: providers.map((member) => ({ id: member.id, name: displayNameOf(member) })),
      services: services.map((service) => ({
        id: service.id,
        name: service.name as Readonly<Record<string, string>>,
        durationMinutes: service.durationMinutes,
        active: service.active,
      })),
      insurance: {
        types: rules.insuranceTypes.filter(isInsuranceType),
        providerTypes: rules.insuranceProviderTypes.filter(isInsuranceType),
        numberTypes: rules.insuranceNumberTypes.filter(isInsuranceType),
      },
    };
  }

  /**
   * W2: seven days of one doctor: every slot with the appointment that holds it, and the absences,
   * in which no slot exists. Every appointment shown writes an audit row, as a list does (BR-18).
   */
  async week(
    { userId }: Actor,
    { providerId, from }: DeskWeekQueryDto,
    ip: string | undefined,
  ): Promise<DeskWeekDto> {
    const { practice } = requirePracticeContext(this.cls);
    const db = this.txHost.tx;
    const settings = await this.rows.displaySettings();
    const now = this.clock.now();
    const today = dayOf(now, settings.timeZone);
    const first = from === undefined ? today : dateOfInput(from, 'from');
    const last = first.add({ days: WEEK_DAYS - 1 });
    const id = providerId.toLowerCase();
    const provider = await db.staffMember.findFirst({
      where: { id, isProvider: true },
      select: { id: true },
    });
    if (provider === null) throw new DomainException('NOT_FOUND');
    const start = dbInstantOf(dayRange(first, settings.timeZone).start);
    const end = dbInstantOf(dayRange(last, settings.timeZone).end);
    const found = await db.slot.findMany({
      where: {
        providerId: id,
        startsAt: { gte: start, lt: end },
        // A free slot without a rule only keeps a cancelled time's history: no one can book it.
        NOT: { status: 'OPEN', ruleId: null },
      },
      select: {
        startsAt: true,
        endsAt: true,
        status: true,
        // At most one that is not cancelled: the partial unique index of BR-01.
        appointments: {
          where: { status: { not: 'CANCELLED' } },
          select: WEEK_APPOINTMENT_FIELDS,
          take: 1,
        },
      },
      orderBy: { startsAt: 'asc' },
      take: WEEK_SLOT_LIMIT + 1,
    });
    const slots = found.slice(0, WEEK_SLOT_LIMIT);
    const absences = await db.availabilityException.findMany({
      where: { providerId: id, startsAt: { lt: end }, endsAt: { gt: start } },
      select: { startsAt: true, endsAt: true, reason: true },
      orderBy: { startsAt: 'asc' },
    });
    const held = slots.flatMap(({ appointments }) => appointments);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    await this.audit.recordEachUnlessRecent({
      userId,
      action: DESK_AUDIT.list,
      subjectIds: held.map((appointment) => appointment.id),
      ipHash,
      minutes: LIST_AUDIT_MINUTES,
    });
    return {
      from: first.toString(),
      to: last.toString(),
      today: today.toString(),
      now: now.toString(),
      providerId: id,
      slots: slots.map((slot) => {
        const holder = slot.appointments[0];
        return {
          startsAt: instantOf(slot.startsAt).toString(),
          endsAt: instantOf(slot.endsAt).toString(),
          status: slot.status,
          appointment:
            holder === undefined
              ? null
              : {
                  id: holder.id,
                  patient: holder.patient,
                  serviceName: holder.service.name as Readonly<Record<string, string>>,
                  status: holder.status,
                },
        };
      }),
      absences: absences.map((absence) => ({
        startsAt: instantOf(absence.startsAt).toString(),
        endsAt: instantOf(absence.endsAt).toString(),
        reason: absence.reason,
      })),
      truncated: found.length > WEEK_SLOT_LIMIT,
      ...settings,
    };
  }

  /**
   * W7: books for a patient of the practice (`AppointmentsService.bookAsPractice`), and answers with
   * the row as the desk shows it.
   */
  async book(
    actor: Actor,
    input: DeskBookingDto,
    idempotencyKey: string | undefined,
    ip: string | undefined,
  ): Promise<DeskAppointmentRowDto> {
    const id = await this.appointments.bookAsPractice(actor, input, idempotencyKey, ip);
    const settings = await this.rows.displaySettings();
    const row = await this.txHost.tx.appointment.findUniqueOrThrow({
      where: { id },
      select: ROW_FIELDS,
    });
    const [view] = await this.rows.viewsOf([row], settings.timeZone);
    if (view === undefined) throw new DomainException('NOT_FOUND');
    return view;
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
    const settings = await this.rows.displaySettings();
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    const names = await this.rows.namesOf([row]);
    const view = this.rows.viewOf(row, names, this.clock.now(), settings.timeZone);
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

  /**
   * After the appointment a page stopped at, with the id deciding between equal starts. The cursor
   * names only the id, and the start is read from its row.
   */
  private async afterPosition(cursor: string): Promise<Prisma.Sql> {
    const id = decodeCursor(cursor, isUuid).toLowerCase();
    const position = await this.txHost.tx.appointment.findUnique({
      where: { id },
      select: { slot: { select: { startsAt: true } } },
    });
    if (position === null) throw invalidCursor();
    return Prisma.sql`(s.starts_at, a.id) > (${position.slot.startsAt}::timestamptz, ${id}::uuid)`;
  }

  private async apply(
    { userId }: Actor,
    id: string,
    change: Change,
    ip: string | undefined,
  ): Promise<DeskAppointmentRowDto> {
    const { practice } = requirePracticeContext(this.cls);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    const settings = await this.rows.displaySettings();
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
      const names = await this.rows.namesOf([written]);
      return this.rows.viewOf(written, names, now, settings.timeZone);
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

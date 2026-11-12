import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context.js';
import { isUuid } from '../../common/context/request-id.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import {
  cursorPageOf,
  decodeCursor,
  invalidCursor,
  MAX_PAGE_SIZE,
} from '../../common/http/cursor-page.js';
import { requirePracticeContext } from '../../common/tenancy/practice-context.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf, instantOf } from '../../common/time/convert.js';
import type { Prisma } from '../../generated/practice/client.js';
import { PUBLIC_PROVIDER } from '../scheduling/domain/public-profile.js';
import type {
  AppointmentDto,
  AppointmentListQueryDto,
  AppointmentPageDto,
} from './appointments.dto.js';
import {
  changeableUntil,
  hasStarted,
  isChangeable,
  UPCOMING_STATUSES,
} from './domain/booking.rules.js';

const APPOINTMENT_FIELDS = {
  id: true,
  patientId: true,
  serviceId: true,
  status: true,
  bookedAt: true,
  endsAt: true,
  service: { select: { name: true } },
  slot: { select: { providerId: true, startsAt: true } },
} as const;

type AppointmentRow = Prisma.AppointmentGetPayload<{ select: typeof APPOINTMENT_FIELDS }>;

function isPosition(text: string): boolean {
  return isUuid(text);
}

function upcomingNow(now: Date): Prisma.AppointmentWhereInput {
  return { status: { in: [...UPCOMING_STATUSES] }, slot: { startsAt: { gt: now } } };
}

function pastNow(now: Date): Prisma.AppointmentWhereInput {
  return {
    OR: [{ status: { notIn: [...UPCOMING_STATUSES] } }, { slot: { startsAt: { lte: now } } }],
  };
}

function displayNameOf(provider: {
  readonly title: string | null;
  readonly firstName: string;
  readonly lastName: string;
}): string {
  return [provider.title, provider.firstName, provider.lastName]
    .filter((part) => part !== null)
    .join(' ');
}

/**
 * Reads a patient's appointments in the practice of the current context. What an answer says of a
 * doctor follows BR-24 at the moment of reading, whichever way the appointment came about. The note
 * is never read here.
 */
@Injectable()
export class AppointmentReader {
  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly cls: ClsService<RequestContext>,
    private readonly clock: Clock,
  ) {}

  /** An appointment known to exist, also in a transaction that just wrote it. */
  async read(id: string): Promise<AppointmentDto> {
    const row = await this.txHost.tx.appointment.findUniqueOrThrow({
      where: { id },
      select: APPOINTMENT_FIELDS,
    });
    return (await this.viewer([row]))(row);
  }

  /** An appointment of the caller's own profile: anyone else's is not there. */
  async own(id: string): Promise<AppointmentDto> {
    const { selfPatientId } = requirePracticeContext(this.cls);
    if (selfPatientId === undefined || !isUuid(id)) throw new DomainException('NOT_FOUND');
    const row = await this.txHost.tx.appointment.findFirst({
      where: { id: id.toLowerCase(), patientId: selfPatientId },
      select: APPOINTMENT_FIELDS,
    });
    if (row === null) throw new DomainException('NOT_FOUND');
    return (await this.viewer([row]))(row);
  }

  /** A page of the caller's own appointments in this practice. */
  async ownPage({ scope, limit, cursor }: AppointmentListQueryDto): Promise<AppointmentPageDto> {
    const { selfPatientId } = requirePracticeContext(this.cls);
    if (selfPatientId === undefined) throw new DomainException('NOT_FOUND');
    const now = dbInstantOf(this.clock.now());
    const ascending = scope === 'upcoming';
    const direction = ascending ? 'asc' : 'desc';
    const rows = await this.txHost.tx.appointment.findMany({
      where: {
        patientId: selfPatientId,
        AND: [
          ascending ? upcomingNow(now) : pastNow(now),
          ...(cursor === undefined
            ? []
            : [await this.afterPosition(cursor, selfPatientId, ascending)]),
        ],
      },
      select: APPOINTMENT_FIELDS,
      orderBy: [{ slot: { startsAt: direction } }, { id: direction }],
      take: limit + 1,
    });
    const page = cursorPageOf(rows, limit, ({ id }) => id);
    return { items: await this.viewsOf(page.items), nextCursor: page.nextCursor };
  }

  /**
   * After the appointment a page stopped at, with the id deciding between equal starts. A cursor names
   * only the id, because it travels in the query string, and the start is read from the patient's own
   * row: the time of an appointment stays out of proxies and browser histories.
   */
  private async afterPosition(
    cursor: string,
    patientId: string,
    ascending: boolean,
  ): Promise<Prisma.AppointmentWhereInput> {
    const id = decodeCursor(cursor, isPosition).toLowerCase();
    const position = await this.txHost.tx.appointment.findFirst({
      where: { id, patientId },
      select: { slot: { select: { startsAt: true } } },
    });
    if (position === null) throw invalidCursor();
    const { startsAt } = position.slot;
    return {
      OR: [
        { slot: { startsAt: ascending ? { gt: startsAt } : { lt: startsAt } } },
        { slot: { startsAt }, id: ascending ? { gt: id } : { lt: id } },
      ],
    };
  }

  /**
   * What is still to come for this account in this practice, for a branch of the fan-out. The practice
   * database says who the patient is, never the index: a stale index row finds nothing.
   */
  async upcomingOfAccount(userId: string): Promise<readonly AppointmentDto[]> {
    const db = this.txHost.tx;
    const patient = await db.patient.findFirst({
      where: { userId, relationship: 'SELF' },
      select: { id: true },
    });
    if (patient === null) return [];
    const rows = await db.appointment.findMany({
      where: { patientId: patient.id, ...upcomingNow(dbInstantOf(this.clock.now())) },
      select: APPOINTMENT_FIELDS,
      orderBy: [{ slot: { startsAt: 'asc' } }, { id: 'asc' }],
      take: MAX_PAGE_SIZE,
    });
    return this.viewsOf(rows);
  }

  private async viewsOf(rows: readonly AppointmentRow[]): Promise<AppointmentDto[]> {
    return rows.length === 0 ? [] : rows.map(await this.viewer(rows));
  }

  /** What rows have in common is read once: the practice's settings, and who may be named. */
  private async viewer(
    rows: readonly AppointmentRow[],
  ): Promise<(row: AppointmentRow) => AppointmentDto> {
    const db = this.txHost.tx;
    const { practice } = requirePracticeContext(this.cls);
    const settings = await db.practiceSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: {
        timeZone: true,
        numberingSystem: true,
        hourCycle: true,
        cancellationDeadlineHours: true,
      },
    });
    const doctors = await db.staffMember.findMany({
      where: {
        id: { in: [...new Set(rows.map(({ slot }) => slot.providerId))] },
        ...PUBLIC_PROVIDER,
      },
      select: { id: true, title: true, firstName: true, lastName: true },
    });
    const named = new Map(doctors.map((doctor) => [doctor.id, doctor]));
    const now = this.clock.now();
    const hours = settings.cancellationDeadlineHours;
    return (row): AppointmentDto => {
      const startsAt = instantOf(row.slot.startsAt);
      const doctor = named.get(row.slot.providerId);
      return {
        id: row.id,
        practiceId: practice.id,
        patientId: row.patientId,
        serviceId: row.serviceId,
        serviceName: row.service.name as Readonly<Record<string, string>>,
        providerId: doctor?.id ?? null,
        providerName: doctor === undefined ? null : displayNameOf(doctor),
        startsAt: startsAt.toString(),
        // The end of the visit, as the service's duration was at booking (BR-27).
        endsAt: instantOf(row.endsAt).toString(),
        timeZone: settings.timeZone,
        numberingSystem: settings.numberingSystem,
        hourCycle: settings.hourCycle,
        status: row.status,
        bookedAt: instantOf(row.bookedAt).toString(),
        changeableUntil: changeableUntil(startsAt, hours).toString(),
        changeable: row.status === 'BOOKED' && isChangeable(now, startsAt, hours),
        started: hasStarted(now, startsAt),
      };
    };
  }
}

import { randomUUID } from 'node:crypto';
import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context.js';
import { isUuid } from '../../common/context/request-id.js';
import { isPrismaKnownRequestError } from '../../common/database/prisma-errors.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { FIELD_ERROR_MESSAGES } from '../../common/errors/field-error-codes.js';
import type { Actor } from '../../common/security/actor.js';
import { AccountTransactions } from '../../common/tenancy/account-transactions.js';
import { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import { requirePracticeContext } from '../../common/tenancy/practice-context.js';
import { PracticeKeys } from '../../common/tenancy/practice-keys.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf, instantOf } from '../../common/time/convert.js';
import type { Prisma } from '../../generated/practice/client.js';
import type { InsuranceTypeName } from '../account-profile/domain/profile.rules.js';
import { PUBLIC_PROVIDER } from '../scheduling/domain/public-profile.js';
import { bookableWindow } from '../scheduling/domain/slots.rules.js';
import { AppointmentReader } from './appointment-reader.js';
import { noteContextOf } from './appointment-texts.js';
import type {
  AppointmentDto,
  BookAppointmentDto,
  RescheduleAppointmentDto,
} from './appointments.dto.js';
import {
  hasBookingPlace,
  IDEMPOTENCY_HOURS,
  isChangeable,
  isInBookingWindow,
  isProfileComplete,
  isServiceBookable,
  UPCOMING_STATUSES,
} from './domain/booking.rules.js';

interface PatientRow {
  readonly insurance_type: InsuranceTypeName;
  readonly insurance_provider: string | null;
  readonly number_known: boolean;
}

/** What a practice says about booking there. */
const BOOKING_SETTINGS = {
  minLeadTimeMinutes: true,
  maxHorizonDays: true,
  maxFutureAppointmentsPerPatient: true,
  cancellationDeadlineHours: true,
  insuranceTypes: true,
  insuranceProviderTypes: true,
  insuranceNumberTypes: true,
} as const;

type BookingSettings = Prisma.PracticeSettingsGetPayload<{ select: typeof BOOKING_SETTINGS }>;

/** What a change needs of an appointment. */
const CHANGE_FIELDS = {
  id: true,
  status: true,
  slotId: true,
  serviceId: true,
  slot: { select: { startsAt: true } },
  rescheduledTo: { select: { id: true } },
} as const;

type ChangeRow = Prisma.AppointmentGetPayload<{ select: typeof CHANGE_FIELDS }>;

/** A time to book, as the rules read it. */
interface Wanted {
  readonly serviceId: string;
  readonly startsAt: Temporal.Instant;
  readonly providerId: string | undefined;
}

/** The new row of a booking or a reschedule. */
interface Placement {
  readonly id: string;
  readonly patientId: string;
  readonly slotId: string;
  readonly serviceId: string;
  readonly sealedNote: string | null;
  readonly userId: string;
  readonly key: string;
  readonly now: Temporal.Instant;
  readonly rescheduledFromId?: string;
}

function fieldError(field: string, code: 'REQUIRED' | 'INVALID_VALUE'): DomainException {
  return new DomainException('VALIDATION_FAILED', {
    fieldErrors: [{ field, code, message: FIELD_ERROR_MESSAGES[code] }],
  });
}

function instantOfInput(value: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    // 2026-02-31T10:00:00Z has the right form and is no time: answered like any other.
    throw fieldError('startsAt', 'INVALID_VALUE');
  }
}

function keyOfHeader(idempotencyKey: string | undefined): string {
  if (idempotencyKey === undefined) throw fieldError('Idempotency-Key', 'REQUIRED');
  if (!isUuid(idempotencyKey)) throw fieldError('Idempotency-Key', 'INVALID_VALUE');
  return idempotencyKey.toLowerCase();
}

function isUniqueViolation(error: unknown): boolean {
  return isPrismaKnownRequestError(error) && error.code === 'P2002';
}

/**
 * Books, reschedules and cancels for the caller's own profile (BR-01 to 05, 08, 09). One transaction
 * in this practice's database takes its locks in one order, key, patient, slot, so that no two of
 * them can wait for each other, and everything a person does here waits for that person's row. A
 * failed attempt rolls its key back, so that a retry with it is judged anew. A replay answers with
 * the appointment as it is now: after a cancel its status says so, and no new booking is made.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly transactions: AccountTransactions,
    private readonly reader: AppointmentReader,
    private readonly cls: ClsService<RequestContext>,
    private readonly clock: Clock,
    private readonly keys: PracticeKeys,
    private readonly audit: PracticeAudit,
  ) {}

  async book(
    { userId }: Actor,
    input: BookAppointmentDto,
    idempotencyKey: string | undefined,
    ip: string | undefined,
  ): Promise<AppointmentDto> {
    const { practice, selfPatientId } = requirePracticeContext(this.cls);
    if (selfPatientId === undefined) throw new DomainException('NOT_FOUND');
    const key = keyOfHeader(idempotencyKey);
    const wanted: Wanted = {
      serviceId: input.serviceId.toLowerCase(),
      startsAt: instantOfInput(input.startsAt),
      providerId: input.providerId?.toLowerCase(),
    };

    // Keyed: the request holds a note, and a plain hash of a short note could be guessed.
    const requestHash = await this.keys.keyedHash(
      practice.id,
      'idempotency-request',
      JSON.stringify([
        wanted.serviceId,
        wanted.startsAt.toString(),
        wanted.providerId ?? null,
        input.patientNote ?? null,
      ]),
    );
    // Before the transaction: both may have to read a key, which no row lock should wait for.
    const id = randomUUID();
    const sealedNote =
      input.patientNote === undefined
        ? null
        : await this.keys.encrypt(practice.id, input.patientNote, noteContextOf(id));
    const ipHash = await this.audit.ipHashOf(practice.id, ip);

    return this.transaction(userId, async () => {
      const db = this.txHost.tx;
      const now = this.clock.now();
      const replayed = await this.claimKey(userId, key, requestHash, now);
      if (replayed !== null) return this.reader.read(replayed);

      const patient = await this.lockPatient(selfPatientId);
      const settings = await this.bookingSettings();
      this.requireCompleteProfile(patient, settings, practice.market);
      await this.requireBookable(wanted, patient, settings, now);

      const upcoming = await db.appointment.count({
        where: {
          patientId: selfPatientId,
          status: { in: [...UPCOMING_STATUSES] },
          slot: { startsAt: { gt: dbInstantOf(now) } },
        },
      });
      const maxFutureAppointments = settings.maxFutureAppointmentsPerPatient;
      if (!hasBookingPlace(upcoming, maxFutureAppointments)) {
        throw new DomainException('BOOKING_LIMIT_REACHED', { params: { maxFutureAppointments } });
      }

      const slotId = await this.takeSlot(wanted, selfPatientId);
      await this.place({
        id,
        patientId: selfPatientId,
        slotId,
        serviceId: wanted.serviceId,
        sealedNote,
        userId,
        key,
        now,
      });
      await this.audit.record({ userId, action: 'appointment.book', subjectId: id, ipHash });
      return this.reader.read(id);
    });
  }

  /**
   * BR-05: a new appointment, and the old one cancelled, in one transaction: whatever fails leaves the
   * old one as it was. It moves an appointment, so BR-02 has nothing to count.
   */
  async reschedule(
    { userId }: Actor,
    appointmentId: string,
    input: RescheduleAppointmentDto,
    idempotencyKey: string | undefined,
    ip: string | undefined,
  ): Promise<AppointmentDto> {
    const { practice, selfPatientId } = requirePracticeContext(this.cls);
    if (selfPatientId === undefined || !isUuid(appointmentId)) {
      throw new DomainException('NOT_FOUND');
    }
    const oldId = appointmentId.toLowerCase();
    const key = keyOfHeader(idempotencyKey);
    const startsAt = instantOfInput(input.startsAt);
    const providerId = input.providerId?.toLowerCase();
    const requestHash = await this.keys.keyedHash(
      practice.id,
      'idempotency-request',
      JSON.stringify(['reschedule', oldId, startsAt.toString(), providerId ?? null]),
    );

    // The note stays, bound to the new row. Before the transaction, as for a booking.
    const source = await this.txHost.tx.appointment.findFirst({
      where: { id: oldId, patientId: selfPatientId },
      select: { patientNoteEncrypted: true },
    });
    if (source === null) throw new DomainException('NOT_FOUND');
    const id = randomUUID();
    const sealedNote =
      source.patientNoteEncrypted === null
        ? null
        : await this.keys.encrypt(
            practice.id,
            await this.keys.decrypt(practice.id, source.patientNoteEncrypted, noteContextOf(oldId)),
            noteContextOf(id),
          );
    const ipHash = await this.audit.ipHashOf(practice.id, ip);

    return this.transaction(userId, async () => {
      const now = this.clock.now();
      const replayed = await this.claimKey(userId, key, requestHash, now);
      if (replayed !== null) return this.reader.read(replayed);

      const patient = await this.lockPatient(selfPatientId);
      const settings = await this.bookingSettings();
      const old = await this.ownRow(oldId, selfPatientId);
      this.requireChangeable(old, settings, now);
      this.requireCompleteProfile(patient, settings, practice.market);
      const wanted: Wanted = { serviceId: old.serviceId, startsAt, providerId };
      await this.requireBookable(wanted, patient, settings, now);

      // Before the old slot is free: the same time with the same doctor is no other time.
      const slotId = await this.takeSlot(wanted, selfPatientId, oldId);
      // The note moves with it: another copy would be one more to keep, export and erase.
      await this.cancelRow(old, userId, now, { keepNote: false });
      await this.place({
        id,
        patientId: selfPatientId,
        slotId,
        serviceId: old.serviceId,
        sealedNote,
        userId,
        key,
        now,
        rescheduledFromId: oldId,
      });
      await this.audit.record({ userId, action: 'appointment.cancel', subjectId: oldId, ipHash });
      await this.audit.record({ userId, action: 'appointment.reschedule', subjectId: id, ipHash });
      return this.reader.read(id);
    });
  }

  /** BR-04. A second cancel changes nothing and answers the same, so that a retry is safe. */
  async cancel(
    { userId }: Actor,
    appointmentId: string,
    ip: string | undefined,
  ): Promise<AppointmentDto> {
    const { practice, selfPatientId } = requirePracticeContext(this.cls);
    if (selfPatientId === undefined || !isUuid(appointmentId)) {
      throw new DomainException('NOT_FOUND');
    }
    const id = appointmentId.toLowerCase();
    const ipHash = await this.audit.ipHashOf(practice.id, ip);

    return this.transactions.run(userId, async () => {
      const now = this.clock.now();
      await this.lockPatient(selfPatientId);
      const old = await this.ownRow(id, selfPatientId);
      // Not for a row that was moved: the person may think the new appointment is gone too.
      if (old.status === 'CANCELLED' && old.rescheduledTo === null) return this.reader.read(id);
      this.requireChangeable(old, await this.bookingSettings(), now);
      await this.cancelRow(old, userId, now, { keepNote: true });
      await this.audit.record({ userId, action: 'appointment.cancel', subjectId: id, ipHash });
      return this.reader.read(id);
    });
  }

  private async transaction(
    userId: string,
    work: () => Promise<AppointmentDto>,
  ): Promise<AppointmentDto> {
    try {
      return await this.transactions.run(userId, work);
    } catch (error) {
      // The partial unique index of BR-01, as the last line behind the slot's lock.
      if (isUniqueViolation(error)) throw new DomainException('SLOT_NOT_AVAILABLE');
      throw error;
    }
  }

  /** Everything a person does in a practice waits here for the others of that person. */
  private async lockPatient(patientId: string): Promise<PatientRow> {
    const [patient] = await this.txHost.tx.$queryRaw<PatientRow[]>`
      SELECT insurance_type, insurance_provider,
             insurance_number_encrypted IS NOT NULL AS number_known
      FROM patients WHERE id = ${patientId}::uuid FOR UPDATE`;
    if (patient === undefined) throw new DomainException('NOT_FOUND');
    return patient;
  }

  private bookingSettings(): Promise<BookingSettings> {
    return this.txHost.tx.practiceSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: BOOKING_SETTINGS,
    });
  }

  private requireCompleteProfile(
    patient: PatientRow,
    settings: BookingSettings,
    market: string,
  ): void {
    const complete = isProfileComplete(settings, market, {
      type: patient.insurance_type,
      provider: patient.insurance_provider,
      numberKnown: patient.number_known,
    });
    if (!complete) throw new DomainException('PATIENT_PROFILE_INCOMPLETE');
  }

  /** BR-03, BR-08, and a doctor who may be asked for by name. */
  private async requireBookable(
    { serviceId, startsAt, providerId }: Wanted,
    patient: PatientRow,
    settings: BookingSettings,
    now: Temporal.Instant,
  ): Promise<void> {
    if (!isInBookingWindow(startsAt, bookableWindow(now, settings))) {
      throw new DomainException('OUTSIDE_BOOKING_WINDOW');
    }
    const service = await this.txHost.tx.service.findUnique({
      where: { id: serviceId },
      select: { active: true, isBookableOnline: true, allowedInsuranceTypes: true },
    });
    if (service === null || !isServiceBookable(service, patient.insurance_type)) {
      throw new DomainException('SERVICE_NOT_BOOKABLE');
    }
    if (providerId !== undefined) await this.requirePublicProvider(providerId);
  }

  /** As for the public free times: a doctor without a public profile is not offered by name. */
  private async requirePublicProvider(id: string): Promise<void> {
    const provider = await this.txHost.tx.staffMember.findFirst({
      where: { id, ...PUBLIC_PROVIDER },
      select: { id: true },
    });
    if (provider === null) throw new DomainException('NOT_FOUND');
  }

  /**
   * SKIP LOCKED: with several doctors free at that time, a booking takes another one's slot instead
   * of waiting for a booking it would then lose to. Marked as booked here, so that the row is held.
   * `moving` is the appointment this one replaces, which BR-25 does not count.
   */
  private async takeSlot(
    { serviceId, startsAt, providerId }: Wanted,
    patientId: string,
    moving?: string,
  ): Promise<string> {
    const db = this.txHost.tx;
    const [slot] = await db.$queryRaw<{ id: string; ends_at: Date }[]>`
      SELECT s.id, s.ends_at
      FROM slots s
      JOIN availability_rule_services rs ON rs.rule_id = s.rule_id
      JOIN staff_members p ON p.id = s.provider_id
      WHERE rs.service_id = ${serviceId}::uuid
        AND s.starts_at = ${dbInstantOf(startsAt)}
        AND s.status = 'OPEN'
        AND p.is_provider
        AND (${providerId ?? null}::uuid IS NULL OR s.provider_id = ${providerId ?? null}::uuid)
      ORDER BY s.provider_id
      LIMIT 1
      FOR UPDATE OF s SKIP LOCKED`;
    // Also without a free slot: the person's own appointment may be the reason, and says it better.
    const until = slot?.ends_at ?? dbInstantOf(startsAt.add({ milliseconds: 1 }));
    await this.requireNoOverlap(patientId, startsAt, until, moving);
    if (slot === undefined) throw new DomainException('SLOT_NOT_AVAILABLE');
    await db.slot.update({ where: { id: slot.id }, data: { status: 'BOOKED' } });
    return slot.id;
  }

  /**
   * BR-25: BR-01 holds per slot, so with several doctors free at one time a person could get two
   * appointments at that time, for instance by loading the page again after an answer got lost, when
   * the key of the first try is gone. Under the patient's lock, so that two tabs cannot both pass.
   */
  private async requireNoOverlap(
    patientId: string,
    startsAt: Temporal.Instant,
    endsAt: Date,
    moving: string | undefined,
  ): Promise<void> {
    const overlapping = await this.txHost.tx.appointment.count({
      where: {
        patientId,
        status: { in: [...UPCOMING_STATUSES] },
        ...(moving === undefined ? {} : { id: { not: moving } }),
        slot: { startsAt: { lt: endsAt }, endsAt: { gt: dbInstantOf(startsAt) } },
      },
    });
    if (overlapping > 0) throw new DomainException('APPOINTMENT_OVERLAP');
  }

  private async place({
    id,
    patientId,
    slotId,
    serviceId,
    sealedNote,
    userId,
    key,
    now,
    rescheduledFromId,
  }: Placement): Promise<void> {
    const db = this.txHost.tx;
    await db.appointment.create({
      data: {
        id,
        patientId,
        slotId,
        serviceId,
        status: 'BOOKED',
        patientNoteEncrypted: sealedNote,
        bookedById: userId,
        bookedAt: dbInstantOf(now),
        ...(rescheduledFromId === undefined ? {} : { rescheduledFromId }),
      },
    });
    await db.idempotencyKey.update({
      where: { actorId_key: { actorId: userId, key } },
      data: { appointmentId: id },
    });
  }

  /** Under the patient's lock, so that nothing of that person changes it meanwhile. */
  private async ownRow(id: string, patientId: string): Promise<ChangeRow> {
    const row = await this.txHost.tx.appointment.findFirst({
      where: { id, patientId },
      select: CHANGE_FIELDS,
    });
    if (row === null) throw new DomainException('NOT_FOUND');
    return row;
  }

  /** BR-04: BOOKED, and not past the practice's deadline. */
  private requireChangeable(
    { status, slot }: ChangeRow,
    { cancellationDeadlineHours }: BookingSettings,
    now: Temporal.Instant,
  ): void {
    if (status !== 'BOOKED') throw new DomainException('INVALID_STATUS_TRANSITION');
    if (!isChangeable(now, instantOf(slot.startsAt), cancellationDeadlineHours)) {
      throw new DomainException('CANCELLATION_DEADLINE_PASSED', {
        params: { cancellationDeadlineHours },
      });
    }
  }

  /** The appointment says who and when, and its slot is free for others again. */
  private async cancelRow(
    { id, slotId }: ChangeRow,
    userId: string,
    now: Temporal.Instant,
    { keepNote }: { readonly keepNote: boolean },
  ): Promise<void> {
    const db = this.txHost.tx;
    await db.appointment.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: dbInstantOf(now),
        cancelledById: userId,
        ...(keepNote ? {} : { patientNoteEncrypted: null }),
      },
    });
    await db.slot.updateMany({
      where: { id: slotId, status: 'BOOKED' },
      data: { status: 'OPEN' },
    });
  }

  /**
   * The key's row, held until the transaction ends: a second request with the key waits here and
   * then finds the first one's result. The id of an earlier result; null when this one goes on.
   */
  private async claimKey(
    actorId: string,
    key: string,
    requestHash: string,
    now: Temporal.Instant,
  ): Promise<string | null> {
    const db = this.txHost.tx;
    const expired = dbInstantOf(now.subtract({ hours: IDEMPOTENCY_HOURS }));
    await db.$executeRaw`
      DELETE FROM idempotency_keys WHERE actor_id = ${actorId}::uuid AND created_at < ${expired}`;
    await db.$executeRaw`
      INSERT INTO idempotency_keys (actor_id, key, request_hash, created_at)
      VALUES (${actorId}::uuid, ${key}::uuid, ${requestHash}, ${dbInstantOf(now)})
      ON CONFLICT DO NOTHING`;
    const [stored] = await db.$queryRaw<{ request_hash: string; appointment_id: string | null }[]>`
      SELECT request_hash, appointment_id FROM idempotency_keys
      WHERE actor_id = ${actorId}::uuid AND key = ${key}::uuid
      FOR UPDATE`;
    if (stored?.request_hash !== requestHash) {
      throw new DomainException('IDEMPOTENCY_KEY_REUSED');
    }
    return stored.appointment_id;
  }
}

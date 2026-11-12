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
import { type HoldLength, holdRangeOf } from '../scheduling/domain/hold.rules.js';
import { PUBLIC_PROVIDER } from '../scheduling/domain/public-profile.js';
import { bookableWindow, practiceBookableWindow } from '../scheduling/domain/slots.rules.js';
import { AppointmentReader } from './appointment-reader.js';
import { limitOverrideReasonContextOf, noteContextOf } from './appointment-texts.js';
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
  isServiceBookableByPractice,
  UPCOMING_STATUSES,
} from './domain/booking.rules.js';
import { type TakenTime, TimeHolds } from './time-holds.js';

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

/** What a booking needs of its service: whether it may be booked, and its time (BR-27). */
const SERVICE_FIELDS = {
  active: true,
  isBookableOnline: true,
  allowedInsuranceTypes: true,
  durationMinutes: true,
  bufferMinutes: true,
} as const;

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
  readonly taken: TakenTime;
  readonly serviceId: string;
  readonly sealedNote: string | null;
  readonly userId: string;
  readonly key: string;
  readonly now: Temporal.Instant;
  readonly rescheduledFromId?: string;
  /** Why the team booked past BR-02's limit, sealed (W7). */
  readonly sealedOverrideReason?: string | null;
}

/** The audit actions of a booking by the team (W7), within and past BR-02's limit. */
export const DESK_BOOKING_AUDIT = {
  book: 'appointment.book_by_practice',
  bookPastLimit: 'appointment.book_by_practice_over_limit',
} as const;

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

/** BR-02, with the limit, which the answer names. */
function limitReached({
  maxFutureAppointmentsPerPatient: maxFutureAppointments,
}: Pick<BookingSettings, 'maxFutureAppointmentsPerPatient'>): DomainException {
  return new DomainException('BOOKING_LIMIT_REACHED', { params: { maxFutureAppointments } });
}

/**
 * Books, reschedules and cancels for the caller's own profile (BR-01 to 05, 08, 09, 27), and books
 * for a patient when the team does (W7). One transaction in this practice's database takes its locks
 * in one order, key, patient, then the doctor's slots SKIP LOCKED (`TimeHolds`), so that no two of
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
    private readonly holds: TimeHolds,
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
      const now = this.clock.now();
      const replayed = await this.claimKey(userId, key, requestHash, now);
      if (replayed !== null) return this.reader.read(replayed);

      const patient = await this.lockPatient(selfPatientId);
      const settings = await this.bookingSettings();
      this.requireCompleteProfile(patient, settings, practice.market);
      const length = await this.requireBookable(wanted, patient, settings, now);

      await this.requireBookingPlace(selfPatientId, settings, now);

      const taken = await this.takeTime(wanted, length, selfPatientId);
      await this.place({
        id,
        patientId: selfPatientId,
        taken,
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
   * W7: the team books for a patient of the practice, on the phone or at the desk. Any active
   * service the patient's insurance allows, any doctor, from now on (BR-03 and BR-08 for the team);
   * BR-01 and BR-25 hold as for a patient's own booking, with the same locks in the same order and
   * the same key. BR-02 too, unless the team gives a reason to book past the limit: kept sealed with
   * the appointment, and the booking is audited apart. Answers the id of the appointment, also of the
   * first one on a replay.
   */
  async bookAsPractice(
    { userId }: Actor,
    input: {
      readonly patientId: string;
      readonly serviceId: string;
      readonly startsAt: string;
      readonly providerId?: string | undefined;
      readonly limitOverrideReason?: string | undefined;
    },
    idempotencyKey: string | undefined,
    ip: string | undefined,
  ): Promise<string> {
    const { practice } = requirePracticeContext(this.cls);
    const key = keyOfHeader(idempotencyKey);
    const patientId = input.patientId.toLowerCase();
    const wanted: Wanted = {
      serviceId: input.serviceId.toLowerCase(),
      startsAt: instantOfInput(input.startsAt),
      providerId: input.providerId?.toLowerCase(),
    };
    // Keyed like a patient's request, which a reason may be part of; the patient is part of it,
    // since the team books for many.
    const requestHash = await this.keys.keyedHash(
      practice.id,
      'idempotency-request',
      JSON.stringify([
        'desk',
        patientId,
        wanted.serviceId,
        wanted.startsAt.toString(),
        wanted.providerId ?? null,
        input.limitOverrideReason ?? null,
      ]),
    );
    const id = randomUUID();
    // Before the transaction, as a patient's note: sealing may have to read a key.
    const sealedReason =
      input.limitOverrideReason === undefined
        ? null
        : await this.keys.encrypt(
            practice.id,
            input.limitOverrideReason,
            limitOverrideReasonContextOf(id),
          );
    const ipHash = await this.audit.ipHashOf(practice.id, ip);

    return this.transaction(userId, async () => {
      const now = this.clock.now();
      const replayed = await this.claimKey(userId, key, requestHash, now);
      if (replayed !== null) return replayed;

      const patient = await this.lockPatient(patientId);
      const settings = await this.bookingSettings();
      const length = await this.requireBookableByPractice(wanted, patient, settings, now);
      const pastLimit = !(await this.hasBookingPlace(patientId, settings, now));
      // BR-02: past the limit only with the team's reason; within it, a reason is not kept.
      if (pastLimit && sealedReason === null) throw limitReached(settings);

      const taken = await this.takeTime(wanted, length, patientId);
      await this.place({
        id,
        patientId,
        taken,
        serviceId: wanted.serviceId,
        sealedNote: null,
        userId,
        key,
        now,
        sealedOverrideReason: pastLimit ? sealedReason : null,
      });
      await this.audit.record({
        userId,
        action: pastLimit ? DESK_BOOKING_AUDIT.bookPastLimit : DESK_BOOKING_AUDIT.book,
        subjectId: id,
        ipHash,
      });
      return id;
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
      const length = await this.requireBookable(wanted, patient, settings, now);

      // The old time's slots first, in the order of their starts (TimeHolds). It counts as free,
      // but not its start: the same time with the same doctor is no other time.
      await this.holds.lockHeld(oldId);
      const taken = await this.takeTime(wanted, length, selfPatientId, {
        id: oldId,
        slotId: old.slotId,
      });
      // The note moves with it: another copy would be one more to keep, export and erase.
      await this.cancelRow(old, userId, now, { keepNote: false });
      await this.place({
        id,
        patientId: selfPatientId,
        taken,
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
      await this.holds.lockHeld(id);
      await this.cancelRow(old, userId, now, { keepNote: true });
      await this.audit.record({ userId, action: 'appointment.cancel', subjectId: id, ipHash });
      return this.reader.read(id);
    });
  }

  private async transaction<T>(userId: string, work: () => Promise<T>): Promise<T> {
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

  /** BR-03, BR-08, and a doctor who may be asked for by name; the service's time (BR-27). */
  private async requireBookable(
    { serviceId, startsAt, providerId }: Wanted,
    patient: PatientRow,
    settings: BookingSettings,
    now: Temporal.Instant,
  ): Promise<HoldLength> {
    if (!isInBookingWindow(startsAt, bookableWindow(now, settings))) {
      throw new DomainException('OUTSIDE_BOOKING_WINDOW');
    }
    const service = await this.txHost.tx.service.findUnique({
      where: { id: serviceId },
      select: SERVICE_FIELDS,
    });
    if (service === null || !isServiceBookable(service, patient.insurance_type)) {
      throw new DomainException('SERVICE_NOT_BOOKABLE');
    }
    if (providerId !== undefined) await this.requirePublicProvider(providerId);
    return service;
  }

  /** BR-03 and BR-08 for the team (W7), and any doctor of the practice; the service's time. */
  private async requireBookableByPractice(
    { serviceId, startsAt, providerId }: Wanted,
    patient: PatientRow,
    settings: BookingSettings,
    now: Temporal.Instant,
  ): Promise<HoldLength> {
    if (!isInBookingWindow(startsAt, practiceBookableWindow(now, settings))) {
      throw new DomainException('OUTSIDE_BOOKING_WINDOW');
    }
    const db = this.txHost.tx;
    const service = await db.service.findUnique({
      where: { id: serviceId },
      select: SERVICE_FIELDS,
    });
    if (service === null || !isServiceBookableByPractice(service, patient.insurance_type)) {
      throw new DomainException('SERVICE_NOT_BOOKABLE');
    }
    if (providerId !== undefined) {
      const provider = await db.staffMember.findFirst({
        where: { id: providerId, isProvider: true },
        select: { id: true },
      });
      if (provider === null) throw new DomainException('NOT_FOUND');
    }
    return service;
  }

  /** BR-02: per patient profile, under its lock. */
  private async requireBookingPlace(
    patientId: string,
    settings: BookingSettings,
    now: Temporal.Instant,
  ): Promise<void> {
    if (!(await this.hasBookingPlace(patientId, settings, now))) throw limitReached(settings);
  }

  /** BR-02: whether the profile may have one more upcoming appointment, under its lock. */
  private async hasBookingPlace(
    patientId: string,
    settings: BookingSettings,
    now: Temporal.Instant,
  ): Promise<boolean> {
    const upcoming = await this.txHost.tx.appointment.count({
      where: {
        patientId,
        status: { in: [...UPCOMING_STATUSES] },
        slot: { startsAt: { gt: dbInstantOf(now) } },
      },
    });
    return hasBookingPlace(upcoming, settings.maxFutureAppointmentsPerPatient);
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
   * The doctor's time for the visit and its buffer (BR-27), held until the transaction ends: with
   * several doctors free at that time, a booking takes another one's time instead of waiting for a
   * booking it would then lose to. `moving` is the appointment this one replaces, which BR-25 does
   * not count and whose time counts as free.
   */
  private async takeTime(
    wanted: Wanted,
    length: HoldLength,
    patientId: string,
    moving?: { readonly id: string; readonly slotId: string },
  ): Promise<TakenTime> {
    const taken = await this.holds.take({ ...wanted, length, moving });
    // Also without a free time: the person's own appointment may be the reason, and says it better.
    const { visitEnd } = holdRangeOf(wanted.startsAt, length);
    await this.requireNoOverlap(patientId, wanted.startsAt, visitEnd, moving?.id);
    if (taken === undefined) throw new DomainException('SLOT_NOT_AVAILABLE');
    return taken;
  }

  /**
   * BR-25: BR-01 holds per slot, so with several doctors free at one time a person could get two
   * appointments at that time, for instance by loading the page again after an answer got lost, when
   * the key of the first try is gone. Under the patient's lock, so that two tabs cannot both pass.
   */
  private async requireNoOverlap(
    patientId: string,
    startsAt: Temporal.Instant,
    endsAt: Temporal.Instant,
    moving: string | undefined,
  ): Promise<void> {
    // The person's visits; the buffer is the doctor's, not the patient's.
    const overlapping = await this.txHost.tx.appointment.count({
      where: {
        patientId,
        status: { in: [...UPCOMING_STATUSES] },
        ...(moving === undefined ? {} : { id: { not: moving } }),
        endsAt: { gt: dbInstantOf(startsAt) },
        slot: { startsAt: { lt: dbInstantOf(endsAt) } },
      },
    });
    if (overlapping > 0) throw new DomainException('APPOINTMENT_OVERLAP');
  }

  private async place({
    id,
    patientId,
    taken,
    serviceId,
    sealedNote,
    userId,
    key,
    now,
    rescheduledFromId,
    sealedOverrideReason,
  }: Placement): Promise<void> {
    const db = this.txHost.tx;
    await db.appointment.create({
      data: {
        id,
        patientId,
        slotId: taken.slotId,
        endsAt: dbInstantOf(taken.visitEnd),
        serviceId,
        status: 'BOOKED',
        patientNoteEncrypted: sealedNote,
        limitOverrideReasonEncrypted: sealedOverrideReason ?? null,
        bookedById: userId,
        bookedAt: dbInstantOf(now),
        ...(rescheduledFromId === undefined ? {} : { rescheduledFromId }),
      },
    });
    await this.holds.hold(taken.heldIds, id);
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

  /**
   * The appointment says who and when, and its whole time is free for others again: the database
   * frees its slots with the cancel (`appointments_release_on_cancel`), after `lockHeld` took them
   * in order. A reschedule then holds again those both times share.
   */
  private async cancelRow(
    { id }: ChangeRow,
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

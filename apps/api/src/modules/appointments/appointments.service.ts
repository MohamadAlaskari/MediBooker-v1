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
import type { InsuranceTypeName } from '../account-profile/domain/profile.rules.js';
import { PUBLIC_PROVIDER } from '../scheduling/domain/public-profile.js';
import { bookableWindow } from '../scheduling/domain/slots.rules.js';
import type { AppointmentDto, BookAppointmentDto } from './appointments.dto.js';
import {
  hasBookingPlace,
  IDEMPOTENCY_HOURS,
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

const APPOINTMENT_FIELDS = {
  id: true,
  patientId: true,
  serviceId: true,
  status: true,
  bookedAt: true,
  slot: { select: { providerId: true, startsAt: true, endsAt: true } },
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

function isUniqueViolation(error: unknown): boolean {
  return isPrismaKnownRequestError(error) && error.code === 'P2002';
}

/**
 * Books a time for the caller's own profile (BR-01, 02, 03, 08, 09). One transaction in this
 * practice's database takes its locks in one order, key, patient, slot, so that no two bookings can
 * wait for each other. A failed booking rolls its key back, so that a retry with it is judged anew.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly transactions: AccountTransactions,
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
    if (idempotencyKey === undefined) throw fieldError('Idempotency-Key', 'REQUIRED');
    if (!isUuid(idempotencyKey)) throw fieldError('Idempotency-Key', 'INVALID_VALUE');
    const key = idempotencyKey.toLowerCase();
    const startsAt = instantOfInput(input.startsAt);
    const serviceId = input.serviceId.toLowerCase();
    const providerId = input.providerId?.toLowerCase();

    // Keyed: the request holds a note, and a plain hash of a short note could be guessed.
    const requestHash = await this.keys.keyedHash(
      practice.id,
      'idempotency-request',
      JSON.stringify([
        serviceId,
        startsAt.toString(),
        providerId ?? null,
        input.patientNote ?? null,
      ]),
    );
    // Before the transaction: both may have to read a key, which no row lock should wait for.
    const id = randomUUID();
    const sealedNote =
      input.patientNote === undefined
        ? null
        : await this.keys.encrypt(practice.id, input.patientNote, `appointment:${id}:patient-note`);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);

    try {
      return await this.transactions.run(userId, async () => {
        const db = this.txHost.tx;
        const now = this.clock.now();
        const replayed = await this.claimKey(userId, key, requestHash, now);
        if (replayed !== null) return this.read(replayed);

        const [patient] = await db.$queryRaw<PatientRow[]>`
          SELECT insurance_type, insurance_provider,
                 insurance_number_encrypted IS NOT NULL AS number_known
          FROM patients WHERE id = ${selfPatientId}::uuid FOR UPDATE`;
        if (patient === undefined) throw new DomainException('NOT_FOUND');

        const settings = await db.practiceSettings.findUniqueOrThrow({
          where: { id: 1 },
          select: {
            minLeadTimeMinutes: true,
            maxHorizonDays: true,
            maxFutureAppointmentsPerPatient: true,
            insuranceTypes: true,
            insuranceProviderTypes: true,
            insuranceNumberTypes: true,
          },
        });
        const complete = isProfileComplete(settings, practice.market, {
          type: patient.insurance_type,
          provider: patient.insurance_provider,
          numberKnown: patient.number_known,
        });
        if (!complete) throw new DomainException('PATIENT_PROFILE_INCOMPLETE');
        if (!isInBookingWindow(startsAt, bookableWindow(now, settings))) {
          throw new DomainException('OUTSIDE_BOOKING_WINDOW');
        }
        const service = await db.service.findUnique({
          where: { id: serviceId },
          select: { active: true, isBookableOnline: true, allowedInsuranceTypes: true },
        });
        if (service === null || !isServiceBookable(service, patient.insurance_type)) {
          throw new DomainException('SERVICE_NOT_BOOKABLE');
        }
        if (providerId !== undefined) await this.requirePublicProvider(providerId);

        const upcoming = await db.appointment.count({
          where: {
            patientId: selfPatientId,
            status: { in: [...UPCOMING_STATUSES] },
            slot: { startsAt: { gt: dbInstantOf(now) } },
          },
        });
        const maxFutureAppointments = settings.maxFutureAppointmentsPerPatient;
        if (!hasBookingPlace(upcoming, maxFutureAppointments)) {
          throw new DomainException('BOOKING_LIMIT_REACHED', {
            params: { maxFutureAppointments },
          });
        }

        // SKIP LOCKED: with several doctors free at that time, a booking takes another one's slot
        // instead of waiting for a booking it would then lose to.
        const [slot] = await db.$queryRaw<{ id: string }[]>`
          SELECT s.id
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
        if (slot === undefined) throw new DomainException('SLOT_NOT_AVAILABLE');

        await db.slot.update({ where: { id: slot.id }, data: { status: 'BOOKED' } });
        await db.appointment.create({
          data: {
            id,
            patientId: selfPatientId,
            slotId: slot.id,
            serviceId,
            status: 'BOOKED',
            patientNoteEncrypted: sealedNote,
            bookedById: userId,
            bookedAt: dbInstantOf(now),
          },
        });
        await db.idempotencyKey.update({
          where: { actorId_key: { actorId: userId, key } },
          data: { appointmentId: id },
        });
        await this.audit.record({ userId, action: 'appointment.book', subjectId: id, ipHash });
        return this.read(id);
      });
    } catch (error) {
      // The partial unique index of BR-01, as the last line behind the slot's lock.
      if (isUniqueViolation(error)) throw new DomainException('SLOT_NOT_AVAILABLE');
      throw error;
    }
  }

  /**
   * The key's row, held until the transaction ends: a second request with the key waits here and
   * then finds the first one's result. The id of an earlier booking; null when this one goes on.
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

  /** As for the public free times: a doctor without a public profile is not offered by name. */
  private async requirePublicProvider(id: string): Promise<void> {
    if ((await this.publicProviderOf(id)) === null) throw new DomainException('NOT_FOUND');
  }

  /** The id, only while that profile is public (BR-24), also when "any doctor" led to this one. */
  private async publicProviderOf(id: string): Promise<string | null> {
    const provider = await this.txHost.tx.staffMember.findFirst({
      where: { id, ...PUBLIC_PROVIDER },
      select: { id: true },
    });
    return provider?.id ?? null;
  }

  private async read(id: string): Promise<AppointmentDto> {
    const row = await this.txHost.tx.appointment.findUniqueOrThrow({
      where: { id },
      select: APPOINTMENT_FIELDS,
    });
    return {
      id: row.id,
      patientId: row.patientId,
      serviceId: row.serviceId,
      providerId: await this.publicProviderOf(row.slot.providerId),
      startsAt: instantOf(row.slot.startsAt).toString(),
      endsAt: instantOf(row.slot.endsAt).toString(),
      status: row.status,
      bookedAt: instantOf(row.bookedAt).toString(),
    };
  }
}

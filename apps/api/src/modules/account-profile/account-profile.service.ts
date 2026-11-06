import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PlatformTransactionHost } from '../../common/database/platform-transactional.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { FIELD_ERROR_MESSAGES } from '../../common/errors/field-error-codes.js';
import type { Actor } from '../../common/security/actor.js';
import { FieldCipher } from '../../common/security/field-cipher.js';
import { auditActorOf, PlatformAudit } from '../../common/security/platform-audit.js';
import { Clock } from '../../common/time/clock.js';
import { dbDateOf, plainDateOf } from '../../common/time/convert.js';
import type { UpdateProfileDto } from './account-profile.dto.js';
import {
  insuranceNumberEnd,
  isPlausibleBirthDate,
  needsInsuranceDetails,
  type InsuranceTypeName,
} from './domain/profile.rules.js';

export interface Profile {
  readonly firstName: string;
  readonly lastName: string;
  readonly dateOfBirth: string;
  readonly phone: string | null;
  readonly insuranceType: InsuranceTypeName;
  readonly insuranceProvider: string | null;
  readonly insuranceNumberEnd: string | null;
}

const SELECTED = {
  firstName: true,
  lastName: true,
  dateOfBirth: true,
  phone: true,
  insuranceType: true,
  insuranceProvider: true,
  insuranceNumberEnd: true,
} as const;

function fieldError(field: string, code: 'REQUIRED' | 'INVALID_VALUE'): DomainException {
  return new DomainException('VALIDATION_FAILED', {
    fieldErrors: [{ field, code, message: FIELD_ERROR_MESSAGES[code] }],
  });
}

/** A person's own details, entered once at sign-up (D16 option B) and copied at a join (B01). */
@Injectable()
export class AccountProfileService {
  constructor(
    @InjectTransactionHost('platform') private readonly txHost: PlatformTransactionHost,
    private readonly clock: Clock,
    private readonly cipher: FieldCipher,
    private readonly audit: PlatformAudit,
  ) {}

  async profileOf(userId: string): Promise<Profile> {
    const row = await this.txHost.tx.accountProfile.findUnique({
      where: { userId },
      select: SELECTED,
    });
    if (row === null) throw new DomainException('NOT_FOUND');
    return { ...row, dateOfBirth: plainDateOf(row.dateOfBirth).toString() };
  }

  /**
   * Replaces the details. The lock of the account's row and the second look at the session make sure
   * that a request in flight cannot write after a reset, which ends the sessions of an account and
   * may hand it to the owner of the address.
   */
  async save(actor: Actor, input: UpdateProfileDto): Promise<Profile> {
    const dateOfBirth = this.birthDateOf(input.dateOfBirth);
    const type = input.insuranceType;
    const insured = needsInsuranceDetails(type);
    const context = `account-profile:${actor.userId}:insurance-number`;
    const encrypted =
      insured && input.insuranceNumber !== undefined
        ? await this.cipher.encrypt(input.insuranceNumber, context)
        : undefined;
    return this.txHost.withTransaction(async () => {
      const db = this.txHost.tx;
      await db.$queryRaw`SELECT 1 FROM users WHERE id = ${actor.userId}::uuid FOR UPDATE`;
      const session = await db.session.findUnique({
        where: { id: actor.sessionId },
        select: { revokedAt: true },
      });
      if (session?.revokedAt !== null) throw new DomainException('UNAUTHENTICATED');
      const known = await db.accountProfile.findUnique({
        where: { userId: actor.userId },
        select: { insuranceNumberEncrypted: true, insuranceNumberEnd: true },
      });
      if (insured && encrypted === undefined && !known?.insuranceNumberEncrypted) {
        throw fieldError('insuranceNumber', 'REQUIRED');
      }
      const details = {
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: dbDateOf(dateOfBirth),
        phone: input.phone ?? null,
        insuranceType: type,
        insuranceProvider: insured ? (input.insuranceProvider ?? null) : null,
        insuranceNumberEncrypted: insured
          ? (encrypted ?? known?.insuranceNumberEncrypted ?? null)
          : null,
        insuranceNumberEnd: !insured
          ? null
          : input.insuranceNumber === undefined
            ? (known?.insuranceNumberEnd ?? null)
            : insuranceNumberEnd(input.insuranceNumber),
      };
      await db.accountProfile.upsert({
        where: { userId: actor.userId },
        create: { userId: actor.userId, ...details },
        update: details,
      });
      await this.audit.record({
        actor: auditActorOf(actor.userId),
        action: 'account.profile.save',
        outcome: 'SUCCEEDED',
      });
      return this.profileOf(actor.userId);
    });
  }

  private birthDateOf(value: string): Temporal.PlainDate {
    try {
      const date = Temporal.PlainDate.from(value, { overflow: 'reject' });
      const today = this.clock.now().toZonedDateTimeISO('UTC').toPlainDate();
      if (isPlausibleBirthDate(date, today)) return date;
    } catch {
      // A date like 2026-02-31 has the right form and is no date: answered like any other.
    }
    throw fieldError('dateOfBirth', 'INVALID_VALUE');
  }
}

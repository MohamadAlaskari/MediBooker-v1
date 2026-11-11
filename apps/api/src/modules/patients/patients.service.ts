import { randomUUID } from 'node:crypto';
import { PRIVACY_NOTICE_VERSION } from '@medibooker/i18n';
import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PinoLogger } from 'nestjs-pino';
import type { RequestContext } from '../../common/context/request-context.js';
import { isPrismaKnownRequestError } from '../../common/database/prisma-errors.js';
import type { PlatformTransactionHost } from '../../common/database/platform-transactional.js';
import { SecretUnavailableError } from '../../common/database/secret-store.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { FIELD_ERROR_MESSAGES } from '../../common/errors/field-error-codes.js';
import type { Actor } from '../../common/security/actor.js';
import { FieldCipher } from '../../common/security/field-cipher.js';
import { IntegrationRelay } from '../../common/tenancy/integration-relay.js';
import type { AccessChange } from '../../common/tenancy/practice-access-index.js';
import { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import { requirePracticeContext } from '../../common/tenancy/practice-context.js';
import { PracticeKeys } from '../../common/tenancy/practice-keys.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { Clock } from '../../common/time/clock.js';
import { dbDateOf, dbInstantOf, instantOf, plainDateOf } from '../../common/time/convert.js';
import type { InsuranceTypeName } from '../account-profile/domain/profile.rules.js';
import { birthDateOf } from './domain/birth-date.rules.js';
import { sealedInsuranceNumber } from './insurance-number.js';
import {
  checkedInsurance,
  type FieldProblem,
  type InsuranceRules,
  normalizedInsuranceNumber,
} from './domain/insurance.rules.js';
import type {
  JoinPracticeDto,
  PatientDto,
  PatientListDto,
  UpdatePatientDto,
} from './patients.dto.js';

const PRIVACY_NOTICE = 'PRIVACY_NOTICE';
/** New practices of one account in a day, held under the account's row lock. */
const JOINS_PER_DAY = 5;
const JOIN_WINDOW_HOURS = 24;

const RULE_FIELDS = {
  insuranceTypes: true,
  insuranceProviderTypes: true,
  insuranceNumberTypes: true,
} as const;

const PATIENT_FIELDS = {
  id: true,
  firstName: true,
  lastName: true,
  dateOfBirth: true,
  contactPhone: true,
  insuranceType: true,
  insuranceProvider: true,
  insuranceNumberEnd: true,
} as const;

interface PatientFields {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly dateOfBirth: Date;
  readonly contactPhone: string | null;
  readonly insuranceType: InsuranceTypeName;
  readonly insuranceProvider: string | null;
  readonly insuranceNumberEnd: string | null;
}

function dtoOf(row: PatientFields): PatientDto {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: plainDateOf(row.dateOfBirth).toString(),
    phone: row.contactPhone,
    insuranceType: row.insuranceType,
    insuranceProvider: row.insuranceProvider,
    insuranceNumberEnd: row.insuranceNumberEnd,
  };
}

function validationFailed(problems: readonly FieldProblem[]): DomainException {
  return new DomainException('VALIDATION_FAILED', {
    fieldErrors: problems.map(({ field, code }) => ({
      field,
      code,
      message: FIELD_ERROR_MESSAGES[code],
    })),
  });
}

function isUniqueViolation(error: unknown): boolean {
  return isPrismaKnownRequestError(error) && error.code === 'P2002';
}

/** In whole seconds, and past the end of the day: its last moment still counts as inside. */
function secondsUntilPlace(now: Temporal.Instant, createdAt: Date): number {
  const end = instantOf(createdAt).add({ hours: JOIN_WINDOW_HOURS });
  return Math.floor(now.until(end).total('seconds')) + 1;
}

/**
 * A person's profile in a practice (D16 option B, BR-10): a join copies the account's details and
 * asks only for what is missing, re-encrypting the number under the practice's own key. A request
 * writes one database in one transaction: first the platform (the place in the day's limit and a
 * consent), then the practice, then the index, which the relay guarantees (ADR 0005 §1.4).
 */
@Injectable()
export class PatientsService {
  constructor(
    @InjectTransactionHost('practice') private readonly practiceTx: PracticeTransactionHost,
    @InjectTransactionHost('platform') private readonly platformTx: PlatformTransactionHost,
    private readonly cls: ClsService<RequestContext>,
    private readonly clock: Clock,
    private readonly cipher: FieldCipher,
    private readonly keys: PracticeKeys,
    private readonly audit: PracticeAudit,
    private readonly relay: IntegrationRelay,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(PatientsService.name);
  }

  async join(actor: Actor, input: JoinPracticeDto, ip: string | undefined): Promise<PatientDto> {
    const { practice } = requirePracticeContext(this.cls);
    const { userId } = actor;
    const existing = await this.practiceTx.tx.patient.findFirst({
      where: { userId, relationship: 'SELF' },
      select: { id: true },
    });
    if (existing !== null) throw new DomainException('ALREADY_JOINED');

    const [rules, profile, consent] = await Promise.all([
      this.rules(),
      this.platformTx.tx.accountProfile.findUnique({ where: { userId } }),
      this.platformTx.tx.accountConsent.findFirst({
        // A new version of the notice asks again.
        where: { userId, type: PRIVACY_NOTICE, textVersion: PRIVACY_NOTICE_VERSION },
        select: { id: true },
      }),
    ]);
    const type = input.insuranceType ?? profile?.insuranceType;
    const sameType = profile !== null && type === profile.insuranceType;
    // Only what this practice asks for: the rest of the account's details stays with the account.
    const asksNumber = type !== undefined && rules.insuranceNumberTypes.includes(type);
    const asksProvider = type !== undefined && rules.insuranceProviderTypes.includes(type);
    const copiedNumber =
      input.insuranceNumber === undefined &&
      sameType &&
      asksNumber &&
      profile.insuranceNumberEncrypted !== null
        ? await this.profileNumberOf(userId, profile.insuranceNumberEncrypted)
        : undefined;
    const insurance = checkedInsurance(rules, practice.market, {
      type,
      provider:
        input.insuranceProvider ?? (sameType && asksProvider ? profile.insuranceProvider : null),
      number: input.insuranceNumber ?? copiedNumber,
      numberKnown: false,
    });
    const firstName = input.firstName ?? profile?.firstName;
    const lastName = input.lastName ?? profile?.lastName;
    const dateOfBirth = this.birthDateOf(
      input.dateOfBirth ??
        (profile === null ? undefined : plainDateOf(profile.dateOfBirth).toString()),
    );
    const birthDate = dateOfBirth.value;
    const needsConsent = consent === null;
    const problems: readonly FieldProblem[] = [
      ...(firstName === undefined ? [{ field: 'firstName', code: 'REQUIRED' } as const] : []),
      ...(lastName === undefined ? [{ field: 'lastName', code: 'REQUIRED' } as const] : []),
      ...dateOfBirth.problems,
      ...insurance.problems,
      ...(needsConsent && input.privacyNoticeVersion === undefined
        ? [{ field: 'privacyNoticeVersion', code: 'REQUIRED' } as const]
        : []),
    ];
    if (
      problems.length > 0 ||
      firstName === undefined ||
      lastName === undefined ||
      birthDate === undefined ||
      type === undefined
    ) {
      throw validationFailed(problems);
    }

    // The keys first: without them nothing may stay behind, neither a place nor a consent.
    const id = randomUUID();
    const sealed =
      insurance.number === undefined ? undefined : await this.sealed(id, insurance.number);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    await this.reservePlace(
      actor,
      practice.id,
      needsConsent ? input.privacyNoticeVersion : undefined,
    );

    const change: AccessChange = { userId, capacity: 'PATIENT', active: true };
    let version: bigint;
    try {
      version = await this.practiceTx.withTransaction(async () => {
        await this.practiceTx.tx.patient.create({
          data: {
            id,
            userId,
            relationship: 'SELF',
            firstName,
            lastName,
            dateOfBirth: dbDateOf(birthDate),
            contactPhone: input.phone === undefined ? (profile?.phone ?? null) : input.phone,
            insuranceType: type,
            insuranceProvider: insurance.provider,
            ...sealed,
          },
        });
        await this.audit.record({ userId, action: 'patient.join', subjectId: id, ipHash });
        return this.relay.recordAccessChange(change);
      });
    } catch (error) {
      // Two joins at once: the partial unique index lets one through.
      if (isUniqueViolation(error)) throw new DomainException('ALREADY_JOINED');
      throw error;
    }
    await this.relay.applyNow(practice.id, version, change);
    return this.read(id);
  }

  /** The profiles the caller may reach here: until family links (FA01) only the own one. */
  async mine(): Promise<PatientListDto> {
    const { selfPatientId } = requirePracticeContext(this.cls);
    return { items: selfPatientId === undefined ? [] : [await this.read(selfPatientId)] };
  }

  async own(patientId: string): Promise<PatientDto> {
    this.requireOwn(patientId);
    return this.read(patientId.toLowerCase());
  }

  /**
   * What is left out stays. Insurance is checked only when it changes: the rules can have moved. All
   * is decided under the row's lock, so that two changes at once cannot leave a self-payer a number.
   */
  async update(
    actor: Actor,
    patientId: string,
    input: UpdatePatientDto,
    ip: string | undefined,
  ): Promise<PatientDto> {
    const { practice } = requirePracticeContext(this.cls);
    this.requireOwn(patientId);
    const id = patientId.toLowerCase();
    const changesInsurance =
      input.insuranceType !== undefined ||
      input.insuranceProvider !== undefined ||
      input.insuranceNumber !== undefined;
    const rules = changesInsurance ? await this.rules() : undefined;
    const dateOfBirth =
      input.dateOfBirth === undefined ? undefined : this.birthDateOf(input.dateOfBirth);
    // Sealed before the lock: it may have to read a key, which a row lock should not wait for.
    const newNumber =
      input.insuranceNumber === undefined
        ? undefined
        : normalizedInsuranceNumber(input.insuranceNumber);
    const sealed = newNumber === undefined ? undefined : await this.sealed(id, newNumber);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    await this.practiceTx.withTransaction(async () => {
      const db = this.practiceTx.tx;
      await db.$queryRaw`SELECT 1 FROM patients WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await db.patient.findUnique({
        where: { id },
        select: {
          insuranceType: true,
          insuranceProvider: true,
          insuranceNumberEncrypted: true,
        },
      });
      if (row === null) throw new DomainException('NOT_FOUND');
      const type = input.insuranceType ?? row.insuranceType;
      const sameType = type === row.insuranceType;
      const insurance =
        rules === undefined
          ? undefined
          : checkedInsurance(rules, practice.market, {
              type,
              provider: input.insuranceProvider ?? (sameType ? row.insuranceProvider : null),
              number: input.insuranceNumber,
              numberKnown: sameType && row.insuranceNumberEncrypted !== null,
            });
      const problems = [...(dateOfBirth?.problems ?? []), ...(insurance?.problems ?? [])];
      if (problems.length > 0) throw validationFailed(problems);
      await db.patient.update({
        where: { id },
        data: {
          ...(input.firstName === undefined ? {} : { firstName: input.firstName }),
          ...(input.lastName === undefined ? {} : { lastName: input.lastName }),
          ...(dateOfBirth?.value === undefined ? {} : { dateOfBirth: dbDateOf(dateOfBirth.value) }),
          ...(input.phone === undefined ? {} : { contactPhone: input.phone }),
          ...(insurance === undefined
            ? {}
            : { insuranceType: type, insuranceProvider: insurance.provider }),
          // A type that keeps none drops what was sent; another type takes none of the old one along.
          ...(insurance?.number === undefined
            ? sameType
              ? {}
              : {
                  insuranceNumberEncrypted: null,
                  insuranceNumberEnd: null,
                  insuranceNumberIndex: null,
                }
            : sealed),
        },
      });
      await this.audit.record({
        userId: actor.userId,
        action: 'patient.update',
        subjectId: id,
        ipHash,
      });
    });
    return this.read(id);
  }

  private async read(id: string): Promise<PatientDto> {
    const row = await this.practiceTx.tx.patient.findUnique({
      where: { id },
      select: PATIENT_FIELDS,
    });
    if (row === null) throw new DomainException('NOT_FOUND');
    return dtoOf(row);
  }

  /** Delegation per patient arrives with family links (FA01); until then only the own profile. */
  private requireOwn(patientId: string): void {
    const { selfPatientId } = requirePracticeContext(this.cls);
    if (selfPatientId !== patientId.toLowerCase()) throw new DomainException('NOT_FOUND');
  }

  private rules(): Promise<InsuranceRules> {
    return this.practiceTx.tx.practiceSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: RULE_FIELDS,
    });
  }

  /** The number of the account; none when it cannot be opened, and then the person is asked. */
  private async profileNumberOf(userId: string, sealed: string): Promise<string | undefined> {
    try {
      return await this.cipher.decrypt(sealed, `account-profile:${userId}:insurance-number`);
    } catch (error) {
      if (error instanceof SecretUnavailableError) throw error;
      this.logger.warn({ err: error }, 'insurance number of an account not readable');
      return undefined;
    }
  }

  /**
   * Holds a place in the day's limit of the account, under its row lock, so that parallel joins
   * cannot pass it. An inactive index row gives no access: the join activates it. The second look at
   * the session makes sure that a request in flight cannot join after a sign-out or a reset.
   */
  private async reservePlace(
    { userId, sessionId }: Actor,
    practiceId: string,
    consentVersion: string | undefined,
  ): Promise<void> {
    const now = this.clock.now();
    await this.platformTx.withTransaction(async () => {
      const db = this.platformTx.tx;
      await db.$queryRaw`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const session = await db.session.findUnique({
        where: { id: sessionId },
        select: { revokedAt: true },
      });
      if (session?.revokedAt !== null) throw new DomainException('UNAUTHENTICATED');
      const others = await db.practiceAccess.findMany({
        where: {
          userId,
          capacity: 'PATIENT',
          practiceId: { not: practiceId },
          createdAt: { gte: dbInstantOf(now.subtract({ hours: JOIN_WINDOW_HOURS })) },
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: JOINS_PER_DAY,
      });
      // The last of the newest: once it has left the day, there is a place again.
      const holding = others[JOINS_PER_DAY - 1];
      if (holding !== undefined) {
        throw new DomainException('JOIN_LIMIT_REACHED', {
          retryAfterSeconds: secondsUntilPlace(now, holding.createdAt),
        });
      }
      await db.practiceAccess.createMany({
        data: [
          {
            userId,
            practiceId,
            capacity: 'PATIENT',
            active: false,
            createdAt: dbInstantOf(now),
            updatedAt: dbInstantOf(now),
          },
        ],
        skipDuplicates: true,
      });
      if (consentVersion !== undefined) {
        await db.accountConsent.create({
          data: {
            userId,
            type: PRIVACY_NOTICE,
            textVersion: consentVersion,
            givenAt: dbInstantOf(now),
          },
        });
      }
    });
  }

  /** The number under this practice's key, its end, and its blind index with this practice's key. */
  private sealed(id: string, number: string): ReturnType<typeof sealedInsuranceNumber> {
    const { practice } = requirePracticeContext(this.cls);
    return sealedInsuranceNumber(this.keys, practice.id, id, number);
  }

  private birthDateOf(value: string | undefined): {
    readonly value: Temporal.PlainDate | undefined;
    readonly problems: readonly FieldProblem[];
  } {
    return birthDateOf(value, this.clock.now().toZonedDateTimeISO('UTC').toPlainDate());
  }
}

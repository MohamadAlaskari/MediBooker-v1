import { randomUUID } from 'node:crypto';
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
import { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import { requirePracticeContext } from '../../common/tenancy/practice-context.js';
import { PracticeKeys } from '../../common/tenancy/practice-keys.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { Clock } from '../../common/time/clock.js';
import { dbDateOf, dbInstantOf, instantOf, plainDateOf } from '../../common/time/convert.js';
import { Prisma } from '../../generated/practice/client.js';
import type { InsuranceTypeName } from '../account-profile/domain/profile.rules.js';
import { birthDateOf } from '../patients/domain/birth-date.rules.js';
import {
  checkedInsurance,
  type FieldProblem,
  normalizedInsuranceNumber,
} from '../patients/domain/insurance.rules.js';
import {
  insuranceNumberIndexOf,
  openedInsuranceNumber,
  sealedInsuranceNumber,
} from '../patients/insurance-number.js';
import type { PatientDto } from '../patients/patients.dto.js';
import { PATIENT_FIELDS, patientDtoOf } from '../patients/patients.service.js';
import { PUBLIC_PROVIDER } from '../scheduling/domain/public-profile.js';
import {
  cancelReasonContextOf,
  limitOverrideReasonContextOf,
  noteContextOf,
} from './appointment-texts.js';
import {
  DESK_AUDIT,
  DeskRows,
  displayNameOf,
  iso,
  LIST_AUDIT_MINUTES,
  ROW_FIELDS,
} from './desk-rows.js';
import type {
  DeskNewPatientDto,
  DeskPatientChangeDto,
  DeskPatientExportAppointmentDto,
  DeskPatientExportDto,
  DeskPatientPageDto,
  DeskPatientRecordDto,
  DeskPatientRowDto,
  DeskPatientSearchDto,
} from './desk.dto.js';
import { ageOn, dayOf } from './domain/desk.rules.js';
import {
  ARABIC_DIGITS,
  ASCII_DIGITS,
  type PatientSearch,
  patientSearchOf,
  searchTextOf,
} from './domain/patient-search.rules.js';

/** What the record of a patient shows of what is to come and what was. */
const RECORD_APPOINTMENTS = 5;

/**
 * The audit actions of the team's reads of patients (BR-18), of a patient it adds (W7), corrects and
 * exports (RT-97).
 */
export const PATIENT_AUDIT = {
  list: 'patient.list',
  read: 'patient.read',
  add: 'patient.add_by_practice',
  /** Added although a patient with the same name and date of birth or number exists (W7). */
  addDespiteMatch: 'patient.add_by_practice_despite_match',
  change: 'patient.update_by_practice',
  /** Changed although it then matches another patient by name and date of birth or number. */
  changeDespiteMatch: 'patient.update_by_practice_despite_match',
  export: 'patient.export',
} as const;

/** Who a profile is, as a match with another patient compares it (W7). */
interface Who {
  readonly firstName: string;
  readonly lastName: string;
  readonly dateOfBirth: Temporal.PlainDate;
}

/** What the copy of a patient's data reads of an appointment (Art. 15). */
const EXPORT_FIELDS = {
  ...ROW_FIELDS,
  bookedAt: true,
  patientNoteEncrypted: true,
  limitOverrideReasonEncrypted: true,
  rescheduledFromId: true,
} as const;

const INSURANCE_RULES = {
  insuranceTypes: true,
  insuranceProviderTypes: true,
  insuranceNumberTypes: true,
} as const;

function validationFailed(problems: readonly FieldProblem[]): DomainException {
  return new DomainException('VALIDATION_FAILED', {
    fieldErrors: problems.map(({ field, code }) => ({
      field,
      code,
      message: FIELD_ERROR_MESSAGES[code],
    })),
  });
}

/** Every condition, or TRUE for none. */
function allOf(conditions: readonly Prisma.Sql[]): Prisma.Sql {
  return conditions.length === 0 ? Prisma.sql`TRUE` : Prisma.join(conditions, ' AND ');
}

interface PatientListRow {
  readonly id: string;
  readonly user_id: string | null;
  readonly first_name: string;
  readonly last_name: string;
  readonly date_of_birth: Date;
  readonly contact_phone: string | null;
  readonly insurance_type: InsuranceTypeName;
  readonly insurance_provider: string | null;
  readonly last_visit_at: Date | null;
  readonly next_appointment_at: Date | null;
}

/**
 * The patients of the practice for its team (M05, W8): found by name however written, by phone, date
 * of birth or insurance number, a page at a time, and one with what is to come and what was. Every
 * patient a list shows writes an audit event, once in five minutes per person, and every record read
 * one of its own (BR-18).
 */
@Injectable()
export class DeskPatients {
  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly platform: PlatformPrismaService,
    private readonly cls: ClsService<RequestContext>,
    private readonly clock: Clock,
    private readonly keys: PracticeKeys,
    private readonly audit: PracticeAudit,
    private readonly rows: DeskRows,
  ) {}

  async page(
    { userId }: Actor,
    { query, insuranceType, limit, cursor }: DeskPatientSearchDto,
    ip: string | undefined,
  ): Promise<DeskPatientPageDto> {
    const { practice } = requirePracticeContext(this.cls);
    const settings = await this.rows.displaySettings();
    const search = query === undefined ? undefined : patientSearchOf(query);
    const where = allOf([
      ...(search === undefined ? [] : [await this.conditionOf(search)]),
      ...(insuranceType === undefined
        ? []
        : [Prisma.sql`p.insurance_type = ${insuranceType}::insurance_type`]),
    ]);
    const after = cursor === undefined ? Prisma.sql`TRUE` : await this.afterPosition(cursor);
    const now = this.clock.now();
    const db = this.txHost.tx;
    const found = await db.$queryRaw<PatientListRow[]>`
      SELECT p.id, p.user_id, p.first_name, p.last_name, p.date_of_birth, p.contact_phone,
        p.insurance_type, p.insurance_provider,
        (SELECT max(s.starts_at) FROM appointments a JOIN slots s ON s.id = a.slot_id
          WHERE a.patient_id = p.id AND a.status IN ('CHECKED_IN', 'COMPLETED')) AS last_visit_at,
        (SELECT min(s.starts_at) FROM appointments a JOIN slots s ON s.id = a.slot_id
          WHERE a.patient_id = p.id AND a.status = 'BOOKED'
            AND s.starts_at > ${dbInstantOf(now)}) AS next_appointment_at
      FROM patients p
      WHERE ${where} AND ${after}
      ORDER BY p.last_name, p.first_name, p.id
      LIMIT ${limit + 1}`;
    // Only the first page counts: a count after a cursor past the end would tell whether a person
    // is a patient here without showing one, and so without an audit row (security review).
    const total =
      cursor === undefined
        ? Number(
            (
              await db.$queryRaw<{ total: bigint }[]>`
                SELECT count(*) AS total FROM patients p WHERE ${where}`
            )[0]?.total ?? 0,
          )
        : null;
    const page = cursorPageOf(found, limit, ({ id }) => id);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    await this.audit.recordEachUnlessRecent({
      userId,
      action: PATIENT_AUDIT.list,
      subjectIds: page.items.map(({ id }) => id),
      ipHash,
      minutes: LIST_AUDIT_MINUTES,
    });
    const today = dayOf(now, settings.timeZone);
    return {
      items: page.items.map((row): DeskPatientRowDto => {
        const dateOfBirth = plainDateOf(row.date_of_birth);
        return {
          id: row.id,
          firstName: row.first_name,
          lastName: row.last_name,
          insuranceType: row.insurance_type,
          dateOfBirth: dateOfBirth.toString(),
          age: ageOn(dateOfBirth, today),
          phone: row.contact_phone,
          insuranceProvider: row.insurance_provider,
          hasAccount: row.user_id !== null,
          lastVisitAt: iso(row.last_visit_at),
          nextAppointmentAt: iso(row.next_appointment_at),
        };
      }),
      nextCursor: page.nextCursor,
      total,
      ...settings,
    };
  }

  /**
   * W7 "Add patient": a person without an account, or not yet with one, as a patient of the practice,
   * with what it asks of every patient (BR-10): the number sealed and indexed as at a join (B01).
   * Such a profile books only through the team, which an account can take over later (FA01).
   */
  async add(
    { userId }: Actor,
    input: DeskNewPatientDto,
    ip: string | undefined,
  ): Promise<DeskPatientRowDto> {
    const { practice } = requirePracticeContext(this.cls);
    const db = this.txHost.tx;
    const rules = await db.practiceSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: INSURANCE_RULES,
    });
    const insurance = checkedInsurance(rules, practice.market, {
      type: input.insuranceType,
      provider: input.insuranceProvider ?? null,
      number: input.insuranceNumber,
      numberKnown: false,
    });
    const today = this.clock.now().toZonedDateTimeISO('UTC').toPlainDate();
    const birthDate = birthDateOf(input.dateOfBirth, today);
    const { firstName, lastName, insuranceType } = input;
    const problems: readonly FieldProblem[] = [
      ...(firstName === undefined ? [{ field: 'firstName', code: 'REQUIRED' } as const] : []),
      ...(lastName === undefined ? [{ field: 'lastName', code: 'REQUIRED' } as const] : []),
      ...birthDate.problems,
      ...insurance.problems,
    ];
    if (
      problems.length > 0 ||
      firstName === undefined ||
      lastName === undefined ||
      birthDate.value === undefined ||
      insuranceType === undefined
    ) {
      throw validationFailed(problems);
    }
    const dateOfBirth = birthDate.value;
    const id = randomUUID();
    const number = insurance.number;
    const sealed =
      number === undefined
        ? undefined
        : await sealedInsuranceNumber(this.keys, practice.id, id, number);
    // The same person twice would split their history and count BR-02 and BR-25 twice: a match by
    // name and date of birth, or by insurance number, asks the team to look first (security review).
    const matched = await this.matches(
      { firstName, lastName, dateOfBirth },
      sealed?.insuranceNumberIndex,
    );
    if (matched && input.confirmDuplicate !== true) throw new DomainException('PATIENT_MAY_EXIST');
    const action = matched ? PATIENT_AUDIT.addDespiteMatch : PATIENT_AUDIT.add;
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    await this.txHost.withTransaction(async () => {
      await this.txHost.tx.patient.create({
        data: {
          id,
          userId: null,
          addedById: userId,
          relationship: 'SELF',
          firstName,
          lastName,
          dateOfBirth: dbDateOf(dateOfBirth),
          contactPhone: input.phone ?? null,
          insuranceType,
          insuranceProvider: insurance.provider,
          ...(sealed ?? {}),
        },
      });
      await this.audit.record({ userId, action, subjectId: id, ipHash });
    });
    const settings = await this.rows.displaySettings();
    return {
      id,
      firstName,
      lastName,
      insuranceType,
      dateOfBirth: dateOfBirth.toString(),
      age: ageOn(dateOfBirth, dayOf(this.clock.now(), settings.timeZone)),
      phone: input.phone ?? null,
      insuranceProvider: insurance.provider,
      hasAccount: false,
      lastVisitAt: null,
      nextAppointmentAt: null,
    };
  }

  /** One patient with what is to come and what was; the read is audited (BR-18). */
  async record(
    { userId }: Actor,
    patientId: string,
    ip: string | undefined,
  ): Promise<DeskPatientRecordDto> {
    if (!isUuid(patientId)) throw new DomainException('NOT_FOUND');
    const id = patientId.toLowerCase();
    const { practice } = requirePracticeContext(this.cls);
    const db = this.txHost.tx;
    const patient = await db.patient.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        contactPhone: true,
        insuranceType: true,
        insuranceProvider: true,
        insuranceNumberEnd: true,
      },
    });
    if (patient === null) throw new DomainException('NOT_FOUND');
    const settings = await this.rows.displaySettings();
    const now = dbInstantOf(this.clock.now());
    const upcoming = await db.appointment.findMany({
      where: { patientId: id, status: 'BOOKED', slot: { startsAt: { gte: now } } },
      select: ROW_FIELDS,
      orderBy: [{ slot: { startsAt: 'asc' } }, { id: 'asc' }],
      take: RECORD_APPOINTMENTS,
    });
    const recent = await db.appointment.findMany({
      where: { patientId: id, slot: { startsAt: { lt: now } } },
      select: ROW_FIELDS,
      orderBy: [{ slot: { startsAt: 'desc' } }, { id: 'desc' }],
      take: RECORD_APPOINTMENTS,
    });
    const account =
      patient.userId === null
        ? null
        : await this.platform.user.findUnique({
            where: { id: patient.userId },
            select: { email: true },
          });
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    await this.audit.record({ userId, action: PATIENT_AUDIT.read, subjectId: id, ipHash });
    // The appointments the record shows, as a list shows them: "who saw appointment A" finds it.
    await this.audit.recordEachUnlessRecent({
      userId,
      action: DESK_AUDIT.list,
      subjectIds: [...upcoming, ...recent].map((appointment) => appointment.id),
      ipHash,
      minutes: LIST_AUDIT_MINUTES,
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
      hasAccount: patient.userId !== null,
      insuranceNumberEnd: patient.insuranceNumberEnd,
      upcoming: await this.rows.viewsOf(upcoming, settings.timeZone),
      recent: await this.rows.viewsOf(recent, settings.timeZone),
      ...settings,
    };
  }

  /**
   * The team corrects a patient without an account (RT-97, GDPR Art. 16): what is left out stays, a
   * null phone removes it, and insurance is checked only when it changes, all under the row's lock
   * as the person's own change (B01). Only an own profile without an account is the team's: one of an
   * account is the person's to change, through the account, and a child's (FA01) its guardian's. A
   * change of who the profile is that makes it match another patient asks first, as W7's add does.
   */
  async change(
    { userId }: Actor,
    patientId: string,
    input: DeskPatientChangeDto,
    ip: string | undefined,
  ): Promise<PatientDto> {
    if (!isUuid(patientId)) throw new DomainException('NOT_FOUND');
    const id = patientId.toLowerCase();
    const { practice } = requirePracticeContext(this.cls);
    const changesInsurance =
      input.insuranceType !== undefined ||
      input.insuranceProvider !== undefined ||
      input.insuranceNumber !== undefined;
    const rules = changesInsurance
      ? await this.txHost.tx.practiceSettings.findUniqueOrThrow({
          where: { id: 1 },
          select: INSURANCE_RULES,
        })
      : undefined;
    const today = this.clock.now().toZonedDateTimeISO('UTC').toPlainDate();
    const birthDate =
      input.dateOfBirth === undefined ? undefined : birthDateOf(input.dateOfBirth, today);
    // Sealed before the lock: it may have to read a key, which a row lock should not wait for.
    const newNumber =
      input.insuranceNumber === undefined
        ? undefined
        : normalizedInsuranceNumber(input.insuranceNumber);
    const sealed =
      newNumber === undefined
        ? undefined
        : await sealedInsuranceNumber(this.keys, practice.id, id, newNumber);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    await this.txHost.withTransaction(async () => {
      const db = this.txHost.tx;
      await db.$queryRaw`SELECT 1 FROM patients WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await db.patient.findUnique({
        where: { id },
        select: {
          userId: true,
          relationship: true,
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          insuranceType: true,
          insuranceProvider: true,
          insuranceNumberEncrypted: true,
        },
      });
      if (row === null) throw new DomainException('NOT_FOUND');
      if (row.userId !== null || row.relationship !== 'SELF') {
        throw new DomainException('PATIENT_HAS_ACCOUNT');
      }
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
      const problems = [...(birthDate?.problems ?? []), ...(insurance?.problems ?? [])];
      if (problems.length > 0) throw validationFailed(problems);
      const changesWho =
        input.firstName !== undefined ||
        input.lastName !== undefined ||
        birthDate?.value !== undefined;
      const numberIndex =
        insurance?.number === undefined ? undefined : sealed?.insuranceNumberIndex;
      const matched = await this.matches(
        changesWho
          ? {
              firstName: input.firstName ?? row.firstName,
              lastName: input.lastName ?? row.lastName,
              dateOfBirth: birthDate?.value ?? plainDateOf(row.dateOfBirth),
            }
          : undefined,
        numberIndex,
        id,
      );
      if (matched && input.confirmDuplicate !== true) {
        throw new DomainException('PATIENT_MAY_EXIST');
      }
      await db.patient.update({
        where: { id },
        data: {
          ...(input.firstName === undefined ? {} : { firstName: input.firstName }),
          ...(input.lastName === undefined ? {} : { lastName: input.lastName }),
          ...(birthDate?.value === undefined ? {} : { dateOfBirth: dbDateOf(birthDate.value) }),
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
        userId,
        action: matched ? PATIENT_AUDIT.changeDespiteMatch : PATIENT_AUDIT.change,
        subjectId: id,
        ipHash,
      });
    });
    const changed = await this.txHost.tx.patient.findUniqueOrThrow({
      where: { id },
      select: PATIENT_FIELDS,
    });
    return patientDtoOf(changed);
  }

  /**
   * Everything the practice keeps about one patient, as the person's copy (RT-97, GDPR Art. 15): the
   * profile with the whole insurance number, and every appointment with what the patient wrote and
   * the team's reasons. For an admin, who checks it before handing it over; audited for the patient
   * and for every appointment it holds.
   */
  async export(
    { userId }: Actor,
    patientId: string,
    ip: string | undefined,
  ): Promise<DeskPatientExportDto> {
    if (!isUuid(patientId)) throw new DomainException('NOT_FOUND');
    const id = patientId.toLowerCase();
    const { practice } = requirePracticeContext(this.cls);
    const db = this.txHost.tx;
    const patient = await db.patient.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        contactPhone: true,
        insuranceType: true,
        insuranceProvider: true,
        insuranceNumberEncrypted: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (patient === null) throw new DomainException('NOT_FOUND');
    const rows = await db.appointment.findMany({
      where: { patientId: id },
      select: EXPORT_FIELDS,
      orderBy: [{ slot: { startsAt: 'asc' } }, { id: 'asc' }],
    });
    const settings = await this.rows.displaySettings();
    // Named as the patient's own view names them: a doctor only with a public profile (BR-24).
    const doctors = await db.staffMember.findMany({
      where: {
        id: { in: [...new Set(rows.map(({ slot }) => slot.providerId))] },
        ...PUBLIC_PROVIDER,
      },
      select: { id: true, title: true, firstName: true, lastName: true },
    });
    const names = new Map(doctors.map((doctor) => [doctor.id, displayNameOf(doctor)]));
    const open = (sealed: string | null, context: string): Promise<string | null> =>
      sealed === null ? Promise.resolve(null) : this.keys.decrypt(practice.id, sealed, context);
    const appointments: DeskPatientExportAppointmentDto[] = [];
    for (const row of rows) {
      appointments.push({
        id: row.id,
        serviceName: row.service.name as Readonly<Record<string, string>>,
        providerName: names.get(row.slot.providerId) ?? null,
        startsAt: instantOf(row.slot.startsAt).toString(),
        endsAt: instantOf(row.endsAt).toString(),
        status: row.status,
        bookedAt: instantOf(row.bookedAt).toString(),
        bookedOnline: row.patient.userId !== null && row.bookedById === row.patient.userId,
        checkedInAt: iso(row.checkedInAt),
        completedAt: iso(row.completedAt),
        cancelledAt: iso(row.cancelledAt),
        patientNote: await open(row.patientNoteEncrypted, noteContextOf(row.id)),
        cancelReason: await open(row.cancelReasonEncrypted, cancelReasonContextOf(row.id)),
        limitOverrideReason: await open(
          row.limitOverrideReasonEncrypted,
          limitOverrideReasonContextOf(row.id),
        ),
        rescheduledFromId: row.rescheduledFromId,
      });
    }
    const insuranceNumber =
      patient.insuranceNumberEncrypted === null
        ? null
        : await openedInsuranceNumber(this.keys, practice.id, id, patient.insuranceNumberEncrypted);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    await this.audit.record({ userId, action: PATIENT_AUDIT.export, subjectId: id, ipHash });
    await this.audit.recordEach({
      userId,
      action: DESK_AUDIT.export,
      subjectIds: rows.map((row) => row.id),
      ipHash,
    });
    return {
      exportedAt: this.clock.now().toString(),
      timeZone: settings.timeZone,
      patient: {
        id: patient.id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        dateOfBirth: plainDateOf(patient.dateOfBirth).toString(),
        phone: patient.contactPhone,
        insuranceType: patient.insuranceType,
        insuranceProvider: patient.insuranceProvider,
        insuranceNumber,
        hasAccount: patient.userId !== null,
        createdAt: instantOf(patient.createdAt).toString(),
        updatedAt: instantOf(patient.updatedAt).toString(),
      },
      appointments,
    };
  }

  /**
   * The patients `p` a search finds, for W8 and for the appointments of W5: every part of it that is
   * there, or the whole of it as an insurance number, which only its blind index compares. A name is
   * compared with the stored `search_name`, so a search folds no name of the database.
   */
  async conditionOf(search: PatientSearch): Promise<Prisma.Sql> {
    const match = allOf([
      ...search.words.map((word) => Prisma.sql`position(${word} in p.search_name) > 0`),
      ...(search.phoneDigits === undefined
        ? []
        : [
            Prisma.sql`regexp_replace(translate(coalesce(p.contact_phone, ''), ${ARABIC_DIGITS}, ${ASCII_DIGITS}), '[^0-9]', '', 'g') LIKE ${`%${search.phoneDigits}%`}`,
          ]),
      ...(search.dateOfBirth === undefined
        ? []
        : [Prisma.sql`p.date_of_birth = ${search.dateOfBirth}::date`]),
    ]);
    if (search.insuranceNumber === undefined) return Prisma.sql`(${match})`;
    const { practice } = requirePracticeContext(this.cls);
    const hash = await insuranceNumberIndexOf(this.keys, practice.id, search.insuranceNumber);
    return Prisma.sql`((${match}) OR p.insurance_number_index = ${hash})`;
  }

  /**
   * Whether another patient has this name and date of birth, or this insurance number (its blind
   * index): maybe the same person (W7). Either may be left out, and `except` is the profile itself.
   */
  private async matches(
    who: Who | undefined,
    numberIndex: string | undefined,
    except?: string,
  ): Promise<boolean> {
    if (who === undefined && numberIndex === undefined) return false;
    const [match] = await this.txHost.tx.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM patients p
      WHERE ((p.search_name = ${who === undefined ? null : searchTextOf(`${who.firstName} ${who.lastName}`)}
            AND p.date_of_birth = ${who?.dateOfBirth.toString() ?? null}::date)
          OR p.insurance_number_index = ${numberIndex ?? null})
        AND p.id IS DISTINCT FROM ${except ?? null}::uuid
      LIMIT 1`;
    return match !== undefined;
  }

  /** After the patient a page stopped at, in the order of the list: last name, first name, id. */
  private async afterPosition(cursor: string): Promise<Prisma.Sql> {
    const id = decodeCursor(cursor, isUuid).toLowerCase();
    const position = await this.txHost.tx.patient.findUnique({
      where: { id },
      select: { firstName: true, lastName: true },
    });
    if (position === null) throw invalidCursor();
    return Prisma.sql`(p.last_name, p.first_name, p.id) > (${position.lastName}, ${position.firstName}, ${id}::uuid)`;
  }
}

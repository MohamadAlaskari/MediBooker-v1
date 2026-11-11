import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context.js';
import { isUuid } from '../../common/context/request-id.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { Actor } from '../../common/security/actor.js';
import { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import { requirePracticeContext } from '../../common/tenancy/practice-context.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { Clock } from '../../common/time/clock.js';
import { dbDateOf } from '../../common/time/convert.js';
import {
  INSURANCE_TYPES,
  type InsuranceTypeName,
} from '../account-profile/domain/profile.rules.js';
import { displayNameOf } from '../appointments/desk-rows.js';
import {
  type FieldProblem,
  LINE_TEXT,
  LINES_TEXT,
  SERVICE_DESCRIPTION_MAX,
  SERVICE_NAME_MAX,
  textsOf,
} from './domain/practice-setup.rules.js';
import { validationFailed } from './practice-setup.errors.js';
import type {
  ServiceDto,
  ServiceInputDto,
  ServiceListDto,
  ServicePatchDto,
  SetupProviderDto,
} from './practice-setup.dto.js';

/** The audit actions of the service catalogue. */
export const SERVICE_AUDIT = { create: 'service.create', update: 'service.update' } as const;

const SERVICE_FIELDS = {
  id: true,
  name: true,
  description: true,
  durationMinutes: true,
  bufferMinutes: true,
  referralRequired: true,
  isBookableOnline: true,
  allowedInsuranceTypes: true,
  active: true,
} as const;

const CATALOG_SETTINGS = {
  supportedLocales: true,
  insuranceTypes: true,
  timeZone: true,
  numberingSystem: true,
  hourCycle: true,
} as const;

function isInsuranceType(value: string): value is InsuranceTypeName {
  return (INSURANCE_TYPES as readonly string[]).includes(value);
}

/** The types a service is for, each once: only types the practice takes. */
function insuranceTypesOf(
  given: readonly InsuranceTypeName[],
  taken: readonly string[],
): { readonly problems: readonly FieldProblem[]; readonly value: InsuranceTypeName[] } {
  const problems = given.flatMap((type, index) =>
    taken.includes(type)
      ? []
      : [{ field: `allowedInsuranceTypes[${String(index)}]`, code: 'INVALID_VALUE' } as const],
  );
  return { problems, value: [...new Set(given)] };
}

/**
 * The practice's services (M02, W12 and W13): every role of the team reads them, only the admin
 * changes them. A service is never deleted: its appointments keep naming it, so it is archived.
 */
@Injectable()
export class ServiceCatalog {
  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly cls: ClsService<RequestContext>,
    private readonly clock: Clock,
    private readonly audit: PracticeAudit,
  ) {}

  async list(): Promise<ServiceListDto> {
    const db = this.txHost.tx;
    const settings = await db.practiceSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: CATALOG_SETTINGS,
    });
    const services = await db.service.findMany({
      select: SERVICE_FIELDS,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    const providers = await this.providersOf(settings.timeZone);
    return {
      services: services.map((service) => this.viewOf(service, providers)),
      locales: settings.supportedLocales,
      insuranceTypes: settings.insuranceTypes.filter(isInsuranceType),
      timeZone: settings.timeZone,
      numberingSystem: settings.numberingSystem,
      hourCycle: settings.hourCycle,
    };
  }

  async create(
    { userId }: Actor,
    input: ServiceInputDto,
    ip: string | undefined,
  ): Promise<ServiceDto> {
    const { practice } = requirePracticeContext(this.cls);
    const settings = await this.txHost.tx.practiceSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: CATALOG_SETTINGS,
    });
    const locales = settings.supportedLocales;
    const name = textsOf('name', input.name, locales, {
      required: true,
      max: SERVICE_NAME_MAX,
      pattern: LINE_TEXT,
    });
    const description = textsOf('description', input.description ?? {}, locales, {
      required: false,
      max: SERVICE_DESCRIPTION_MAX,
      pattern: LINES_TEXT,
    });
    const insurance = insuranceTypesOf(input.allowedInsuranceTypes ?? [], settings.insuranceTypes);
    const problems = [...name.problems, ...description.problems, ...insurance.problems];
    if (problems.length > 0) throw validationFailed(problems);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    const id = await this.txHost.withTransaction(async () => {
      const tx = this.txHost.tx;
      const { _max } = await tx.service.aggregate({ _max: { sortOrder: true } });
      const created = await tx.service.create({
        data: {
          name: name.value,
          description: description.value,
          durationMinutes: input.durationMinutes,
          bufferMinutes: input.bufferMinutes ?? 0,
          referralRequired: input.referralRequired ?? false,
          isBookableOnline: input.isBookableOnline ?? true,
          allowedInsuranceTypes: insurance.value,
          sortOrder: (_max.sortOrder ?? -1) + 1,
        },
        select: { id: true },
      });
      await this.audit.record({
        userId,
        action: SERVICE_AUDIT.create,
        subjectId: created.id,
        ipHash,
      });
      return created.id;
    });
    return this.one(id, settings.timeZone);
  }

  async update(
    { userId }: Actor,
    serviceId: string,
    input: ServicePatchDto,
    ip: string | undefined,
  ): Promise<ServiceDto> {
    const { practice } = requirePracticeContext(this.cls);
    if (!isUuid(serviceId)) throw new DomainException('NOT_FOUND');
    const settings = await this.txHost.tx.practiceSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: CATALOG_SETTINGS,
    });
    const locales = settings.supportedLocales;
    const name =
      input.name === undefined
        ? undefined
        : textsOf('name', input.name, locales, {
            required: true,
            max: SERVICE_NAME_MAX,
            pattern: LINE_TEXT,
          });
    const description =
      input.description === undefined
        ? undefined
        : textsOf('description', input.description, locales, {
            required: false,
            max: SERVICE_DESCRIPTION_MAX,
            pattern: LINES_TEXT,
          });
    const insurance =
      input.allowedInsuranceTypes === undefined
        ? undefined
        : insuranceTypesOf(input.allowedInsuranceTypes, settings.insuranceTypes);
    const problems = [
      ...(name?.problems ?? []),
      ...(description?.problems ?? []),
      ...(insurance?.problems ?? []),
    ];
    if (problems.length > 0) throw validationFailed(problems);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    await this.txHost.withTransaction(async () => {
      const { count } = await this.txHost.tx.service.updateMany({
        where: { id: serviceId },
        data: {
          ...(name === undefined ? {} : { name: name.value }),
          ...(description === undefined ? {} : { description: description.value }),
          ...(input.durationMinutes === undefined
            ? {}
            : { durationMinutes: input.durationMinutes }),
          ...(input.bufferMinutes === undefined ? {} : { bufferMinutes: input.bufferMinutes }),
          ...(input.referralRequired === undefined
            ? {}
            : { referralRequired: input.referralRequired }),
          ...(input.isBookableOnline === undefined
            ? {}
            : { isBookableOnline: input.isBookableOnline }),
          ...(insurance === undefined ? {} : { allowedInsuranceTypes: insurance.value }),
          ...(input.active === undefined ? {} : { active: input.active }),
        },
      });
      if (count === 0) throw new DomainException('NOT_FOUND');
      await this.audit.record({
        userId,
        action: SERVICE_AUDIT.update,
        subjectId: serviceId,
        ipHash,
      });
    });
    return this.one(serviceId, settings.timeZone);
  }

  private async one(id: string, timeZone: string): Promise<ServiceDto> {
    const service = await this.txHost.tx.service.findUniqueOrThrow({
      where: { id },
      select: SERVICE_FIELDS,
    });
    return this.viewOf(service, await this.providersOf(timeZone));
  }

  /**
   * The doctors whose working hours offer each service, today or later: a rule that ended before
   * today offers nothing any more. M04 lets the team change them.
   */
  private async providersOf(
    timeZone: string,
  ): Promise<ReadonlyMap<string, readonly SetupProviderDto[]>> {
    const today = this.clock.now().toZonedDateTimeISO(timeZone).toPlainDate();
    const links = await this.txHost.tx.availabilityRuleService.findMany({
      where: { rule: { OR: [{ validTo: null }, { validTo: { gte: dbDateOf(today) } }] } },
      select: {
        serviceId: true,
        rule: {
          select: {
            provider: { select: { id: true, title: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    const byService = new Map<string, Map<string, SetupProviderDto>>();
    for (const { serviceId, rule } of links) {
      const providers = byService.get(serviceId) ?? new Map<string, SetupProviderDto>();
      providers.set(rule.provider.id, { id: rule.provider.id, name: displayNameOf(rule.provider) });
      byService.set(serviceId, providers);
    }
    return new Map(
      [...byService].map(([serviceId, providers]) => [
        serviceId,
        [...providers.values()].toSorted((a, b) => a.name.localeCompare(b.name)),
      ]),
    );
  }

  private viewOf(
    service: {
      readonly id: string;
      readonly name: unknown;
      readonly description: unknown;
      readonly durationMinutes: number;
      readonly bufferMinutes: number;
      readonly referralRequired: boolean;
      readonly isBookableOnline: boolean;
      readonly allowedInsuranceTypes: readonly string[];
      readonly active: boolean;
    },
    providers: ReadonlyMap<string, readonly SetupProviderDto[]>,
  ): ServiceDto {
    return {
      id: service.id,
      name: service.name as Readonly<Record<string, string>>,
      description: service.description as Readonly<Record<string, string>>,
      durationMinutes: service.durationMinutes,
      bufferMinutes: service.bufferMinutes,
      referralRequired: service.referralRequired,
      isBookableOnline: service.isBookableOnline,
      allowedInsuranceTypes: service.allowedInsuranceTypes.filter(isInsuranceType),
      active: service.active,
      providers: providers.get(service.id) ?? [],
    };
  }
}

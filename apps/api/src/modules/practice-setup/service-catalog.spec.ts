import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../common/context/request-context.js';
import type { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { FixedClock } from '../../common/time/fixed-clock.js';
import { ServiceCatalog } from './service-catalog.js';

const cls = ClsServiceManager.getClsService<RequestContext>();
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const ACTOR = { userId: '00000000-0000-4000-8000-000000000001', sessionId: 's', amr: ['pwd'] };
const SERVICE_ID = '00000000-0000-4000-8000-0000000000aa';
const SETTINGS = {
  supportedLocales: ['ar', 'en'],
  insuranceTypes: ['PUBLIC', 'SELF_PAY', 'LEGACY'],
  timeZone: 'Asia/Riyadh',
  numberingSystem: 'latn',
  hourCycle: 'h23',
};
const ROW = {
  id: SERVICE_ID,
  name: { ar: 'فحص', en: 'Check-up' },
  description: {},
  durationMinutes: 30,
  isBookableOnline: true,
  allowedInsuranceTypes: ['SELF_PAY', 'LEGACY'],
  active: true,
};
const doctor = (id: string, firstName: string) => ({
  serviceId: SERVICE_ID,
  rule: { provider: { id, title: 'Dr.', firstName, lastName: 'Example' } },
});

function setUp({
  maxSortOrder = 4,
  updated = 1,
}: { readonly maxSortOrder?: number | null; readonly updated?: number } = {}) {
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    practiceSettings: { findUniqueOrThrow: vi.fn().mockResolvedValue(SETTINGS) },
    service: {
      findMany: vi.fn().mockResolvedValue([ROW]),
      findUniqueOrThrow: vi.fn().mockResolvedValue(ROW),
      findUnique: vi.fn().mockResolvedValue({ id: SERVICE_ID }),
      aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: maxSortOrder } }),
      create: vi.fn().mockResolvedValue({ id: SERVICE_ID }),
      updateMany: vi.fn().mockResolvedValue({ count: updated }),
    },
    availabilityRuleService: {
      findMany: vi
        .fn()
        .mockResolvedValue([doctor('p2', 'Omar'), doctor('p1', 'Lina'), doctor('p2', 'Omar')]),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    availabilityRule: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'r1', providerId: 'p1' },
        { id: 'r2', providerId: 'p2' },
      ]),
    },
    staffMember: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'p1',
          title: 'Dr.',
          firstName: 'Lina',
          lastName: 'Example',
          availabilityRules: [{ id: 'r1' }],
        },
        { id: 'p3', title: null, firstName: 'Sami', lastName: 'Neu', availabilityRules: [] },
      ]),
    },
  };
  const audit = {
    record: vi.fn().mockResolvedValue(undefined),
    ipHashOf: vi.fn().mockResolvedValue('ip-hash'),
  };
  const txHost = {
    tx: db,
    withTransaction: <T>(work: () => Promise<T>): Promise<T> => work(),
  } as unknown as PracticeTransactionHost;
  const catalog = new ServiceCatalog(
    txHost,
    cls,
    new FixedClock(NOW),
    audit as unknown as PracticeAudit,
  );
  const inPractice = <T>(work: () => Promise<T>) =>
    cls.run(() => {
      cls.set('practice', {
        practice: { id: 'practice-a', market: 'SA', routeVersion: 1, schemaVersion: 'v' },
        lease: {} as never,
        staff: {
          membershipId: 'membership',
          role: 'STAFF',
          managesPractice: true,
          providerId: null,
        },
      });
      return work();
    });
  return { catalog, db, audit, inPractice };
}

describe('ServiceCatalog.list', () => {
  it('names each doctor once, by name, and only the insurance types it knows', async () => {
    const { catalog, db } = setUp();
    const list = await catalog.list();
    expect(list).toMatchObject({
      locales: ['ar', 'en'],
      insuranceTypes: ['PUBLIC', 'SELF_PAY'],
      timeZone: 'Asia/Riyadh',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      doctors: [
        { id: 'p1', name: 'Dr. Lina Example', hasWorkingHours: true },
        { id: 'p3', name: 'Sami Neu', hasWorkingHours: false },
      ],
    });
    expect(list.services[0]).toMatchObject({
      allowedInsuranceTypes: ['SELF_PAY'],
      providers: [
        { id: 'p1', name: 'Dr. Lina Example' },
        { id: 'p2', name: 'Dr. Omar Example' },
      ],
    });
    // A rule that ended before today offers nothing any more.
    expect(db.availabilityRuleService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          rule: {
            OR: [{ validTo: null }, { validTo: { gte: new Date('2026-11-15T00:00:00Z') } }],
          },
        },
      }),
    );
  });

  it('names no doctor for a service without working hours', async () => {
    const { catalog, db } = setUp();
    db.availabilityRuleService.findMany.mockResolvedValueOnce([]);
    expect((await catalog.list()).services[0]?.providers).toEqual([]);
  });
});

describe('ServiceCatalog.create', () => {
  it('adds a service last, with each insurance type once, and audits it', async () => {
    const { catalog, db, audit, inPractice } = setUp();
    await inPractice(() =>
      catalog.create(
        ACTOR,
        {
          name: { ar: ' فحص ', en: 'Check-up' },
          durationMinutes: 30,
          allowedInsuranceTypes: ['SELF_PAY', 'SELF_PAY'],
        },
        '198.51.100.1',
      ),
    );
    expect(db.service.create).toHaveBeenCalledWith({
      data: {
        name: { ar: 'فحص', en: 'Check-up' },
        description: {},
        durationMinutes: 30,
        bufferMinutes: 0,
        referralRequired: false,
        isBookableOnline: true,
        allowedInsuranceTypes: ['SELF_PAY'],
        sortOrder: 5,
      },
      select: { id: true },
    });
    expect(audit.record).toHaveBeenCalledWith({
      userId: ACTOR.userId,
      action: 'service.create',
      subjectId: SERVICE_ID,
      ipHash: 'ip-hash',
    });
  });

  it('puts the first service first, and keeps one patients cannot book online so', async () => {
    const { catalog, db, inPractice } = setUp({ maxSortOrder: null });
    await inPractice(() =>
      catalog.create(
        ACTOR,
        {
          name: { ar: 'فحص', en: 'Check-up' },
          description: { en: 'Fasting.' },
          durationMinutes: 30,
          isBookableOnline: false,
        },
        undefined,
      ),
    );
    expect(db.service.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        sortOrder: 0,
        isBookableOnline: false,
        description: { en: 'Fasting.' },
        allowedInsuranceTypes: [],
      },
    });
  });

  it('refuses a missing name and a type the practice does not take, and writes nothing', async () => {
    const { catalog, db, inPractice } = setUp();
    await expect(
      inPractice(() =>
        catalog.create(
          ACTOR,
          { name: { en: 'Check-up' }, durationMinutes: 30, allowedInsuranceTypes: ['PRIVATE'] },
          undefined,
        ),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [
        { field: 'name.ar', code: 'REQUIRED' },
        { field: 'allowedInsuranceTypes[0]', code: 'INVALID_VALUE' },
      ],
    });
    expect(db.service.create).not.toHaveBeenCalled();
  });
});

describe('ServiceCatalog.update', () => {
  it('changes only what is given, and audits it', async () => {
    const { catalog, db, audit, inPractice } = setUp();
    await inPractice(() =>
      catalog.update(
        ACTOR,
        SERVICE_ID,
        {
          name: { ar: 'فحص', en: 'Check-up' },
          description: { en: '' },
          durationMinutes: 45,
          bufferMinutes: 10,
          referralRequired: true,
          isBookableOnline: false,
          allowedInsuranceTypes: ['PUBLIC'],
          active: false,
        },
        undefined,
      ),
    );
    expect(db.service.updateMany).toHaveBeenCalledWith({
      where: { id: SERVICE_ID },
      data: {
        name: { ar: 'فحص', en: 'Check-up' },
        description: {},
        durationMinutes: 45,
        bufferMinutes: 10,
        referralRequired: true,
        isBookableOnline: false,
        allowedInsuranceTypes: ['PUBLIC'],
        active: false,
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'service.update', subjectId: SERVICE_ID }),
    );
    await inPractice(() => catalog.update(ACTOR, SERVICE_ID, { active: true }, undefined));
    expect(db.service.updateMany).toHaveBeenLastCalledWith({
      where: { id: SERVICE_ID },
      data: { active: true },
    });
  });

  it('answers NOT_FOUND for an id that is none or names no service', async () => {
    const { catalog, inPractice } = setUp({ updated: 0 });
    await expect(
      inPractice(() => catalog.update(ACTOR, 'not-a-uuid', { active: false }, undefined)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      inPractice(() => catalog.update(ACTOR, SERVICE_ID, { active: false }, undefined)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses texts and types as a new service does', async () => {
    const { catalog, db, inPractice } = setUp();
    await expect(
      inPractice(() =>
        catalog.update(
          ACTOR,
          SERVICE_ID,
          {
            name: { ar: '', en: 'Check-up' },
            description: { de: 'Nüchtern' },
            allowedInsuranceTypes: ['PRIVATE'],
          },
          undefined,
        ),
      ),
    ).rejects.toMatchObject({
      fieldErrors: [
        { field: 'name.ar', code: 'REQUIRED' },
        { field: 'description.de', code: 'UNKNOWN_FIELD' },
        { field: 'allowedInsuranceTypes[0]', code: 'INVALID_VALUE' },
      ],
    });
    expect(db.service.updateMany).not.toHaveBeenCalled();
  });
});

describe('ServiceCatalog.setProviders', () => {
  it('adds the service to the named doctors’ rules and takes it out of the others’', async () => {
    const { catalog, db, audit, inPractice } = setUp();
    db.availabilityRule.findMany
      .mockResolvedValueOnce([{ providerId: 'p1' }])
      .mockResolvedValueOnce([
        { id: 'r1', providerId: 'p1' },
        { id: 'r2', providerId: 'p2' },
      ]);
    await inPractice(() =>
      catalog.setProviders(ACTOR, SERVICE_ID, { providerIds: ['p1', 'p1'] }, undefined),
    );
    // The doctors' rows first, so that no week changes between the read and the write.
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.availabilityRuleService.createMany).toHaveBeenCalledWith({
      data: [{ ruleId: 'r1', serviceId: SERVICE_ID }],
      skipDuplicates: true,
    });
    expect(db.availabilityRuleService.deleteMany).toHaveBeenCalledWith({
      where: { serviceId: SERVICE_ID, ruleId: { in: ['r2'] } },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'service.providers', subjectId: SERVICE_ID }),
    );
  });

  it('refuses a doctor without working hours, and an unknown service', async () => {
    const { catalog, db, inPractice } = setUp();
    db.availabilityRule.findMany.mockResolvedValueOnce([]);
    await expect(
      inPractice(() => catalog.setProviders(ACTOR, SERVICE_ID, { providerIds: ['p3'] }, undefined)),
    ).rejects.toMatchObject({
      fieldErrors: [{ field: 'providerIds[0]', code: 'INVALID_VALUE' }],
    });
    await expect(
      inPractice(() => catalog.setProviders(ACTOR, 'not-a-uuid', { providerIds: [] }, undefined)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    db.service.findUnique.mockResolvedValueOnce(null);
    await expect(
      inPractice(() => catalog.setProviders(ACTOR, SERVICE_ID, { providerIds: [] }, undefined)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../common/context/request-context.js';
import type { PlatformPrismaService } from '../../common/database/platform-prisma.service.js';
import type { AccountTransactions } from '../../common/tenancy/account-transactions.js';
import type { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import type { PracticeKeys } from '../../common/tenancy/practice-keys.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { FixedClock } from '../../common/time/fixed-clock.js';
import { Prisma } from '../../generated/practice/client.js';
import type { AppointmentsService } from './appointments.service.js';
import type { DeskPatients } from './desk-patients.js';
import { DeskRows } from './desk-rows.js';
import { DESK_DAY_LIMIT, DeskService, WEEK_SLOT_LIMIT } from './desk.service.js';

const cls = ClsServiceManager.getClsService<RequestContext>();
/** 10:00 in Riyadh on Sunday 15 November 2026. */
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const STAFF_USER = '00000000-0000-4000-8000-000000000001';
const PATIENT_USER = '00000000-0000-4000-8000-000000000002';
const ID = '00000000-0000-4000-8000-0000000000aa';
const PATIENT = '00000000-0000-4000-8000-0000000000bb';
const PROVIDER = '00000000-0000-4000-8000-0000000000cc';
const SLOT = '00000000-0000-4000-8000-0000000000dd';
const ACTOR = { userId: STAFF_USER, sessionId: 'session', amr: ['pwd', 'otp'] };
const SETTINGS = { timeZone: 'Asia/Riyadh', numberingSystem: 'latn', hourCycle: 'h23' };

/** Booked at 12:00 in Riyadh today. */
const ROW = {
  id: ID,
  serviceId: 'service',
  status: 'BOOKED',
  bookedById: PATIENT_USER,
  checkedInAt: null,
  completedAt: null,
  cancelledAt: null,
  cancelReasonEncrypted: null,
  patient: {
    id: PATIENT,
    userId: PATIENT_USER,
    firstName: 'Sami',
    lastName: 'Beispiel',
    insuranceType: 'SELF_PAY',
  },
  service: { name: { en: 'Check-up' }, durationMinutes: 30 },
  slot: {
    providerId: PROVIDER,
    startsAt: new Date('2026-11-15T09:00:00Z'),
    endsAt: new Date('2026-11-15T09:30:00Z'),
  },
};

const DETAIL = {
  ...ROW,
  bookedAt: new Date('2026-11-14T15:00:00Z'),
  patientNoteEncrypted: 'sealed-note',
  patient: {
    ...ROW.patient,
    dateOfBirth: new Date('1990-04-12T00:00:00Z'),
    insuranceProvider: null,
    contactPhone: '+966 50 000 0000',
  },
};

function setUp({
  rows = [ROW],
  detail = DETAIL,
  status = 'BOOKED',
  slotStartsAt = ROW.slot.startsAt,
  cancelReasonEncrypted = null,
}: {
  readonly rows?: readonly object[];
  readonly detail?: object | null;
  readonly status?: string;
  readonly slotStartsAt?: Date;
  readonly cancelReasonEncrypted?: string | null;
} = {}) {
  const changing = {
    status,
    slotId: SLOT,
    cancelReasonEncrypted,
    slot: { startsAt: slotStartsAt },
  };
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    practiceSettings: { findUniqueOrThrow: vi.fn().mockResolvedValue(SETTINGS) },
    appointment: {
      findMany: vi.fn().mockResolvedValue(rows),
      groupBy: vi.fn().mockResolvedValue([
        { status: 'BOOKED', _count: { _all: 3 } },
        { status: 'CANCELLED', _count: { _all: 1 } },
      ]),
      findUnique: vi.fn((args: { select: Record<string, unknown> }) =>
        Promise.resolve(
          'patientId' in args.select ? (detail === null ? null : { patientId: PATIENT }) : detail,
        ),
      ),
      findUniqueOrThrow: vi
        .fn()
        .mockImplementation((args: { select: Record<string, unknown> }) =>
          Promise.resolve('slotId' in args.select ? changing : ROW),
        ),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(12),
    },
    service: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: 'service', name: { en: 'Check-up' }, durationMinutes: 30, active: true },
        ]),
    },
    slot: {
      count: vi.fn().mockResolvedValue(4),
      findFirst: vi.fn().mockResolvedValue({ startsAt: new Date('2026-11-15T10:00:00Z') }),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    availabilityException: { findMany: vi.fn().mockResolvedValue([]) },
    staffMember: {
      findFirst: vi.fn().mockResolvedValue({ id: PROVIDER }),
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: PROVIDER, title: 'Dr.', firstName: 'Lina', lastName: 'Example' },
        ]),
    },
  };
  const platform = {
    user: { findUnique: vi.fn().mockResolvedValue({ email: 'patient@example.test' }) },
  };
  const run = vi.fn(<T>(_userId: string, work: () => Promise<T>): Promise<T> => work());
  const encrypt = vi.fn().mockResolvedValue('sealed-reason');
  const decrypt = vi.fn((_practice: string, value: string) =>
    Promise.resolve(value === 'sealed-note' ? 'Synthetic note' : 'Synthetic reason'),
  );
  const audit = {
    record: vi.fn().mockResolvedValue(undefined),
    recordEachUnlessRecent: vi.fn().mockResolvedValue(undefined),
    ipHashOf: vi.fn().mockResolvedValue('ip-hash'),
  };
  const txHost = { tx: db } as unknown as PracticeTransactionHost;
  const clock = new FixedClock(NOW);
  const conditionOf = vi.fn().mockResolvedValue(Prisma.sql`p.search_name <> ''`);
  const bookAsPractice = vi.fn().mockResolvedValue(ID);
  const service = new DeskService(
    txHost,
    platform as unknown as PlatformPrismaService,
    { run } as unknown as AccountTransactions,
    cls,
    clock,
    { encrypt, decrypt } as unknown as PracticeKeys,
    audit as unknown as PracticeAudit,
    new DeskRows(txHost, clock),
    { conditionOf } as unknown as DeskPatients,
    { bookAsPractice } as unknown as AppointmentsService,
  );
  const inPractice = <T>(work: () => Promise<T>) =>
    cls.run(() => {
      cls.set('practice', {
        practice: { id: 'practice-a', market: 'SA', routeVersion: 1, schemaVersion: 'v' },
        lease: {} as never,
        staff: { membershipId: 'membership', role: 'STAFF', providerId: null },
      });
      return work();
    });
  return { service, db, platform, audit, encrypt, conditionOf, bookAsPractice, inPractice };
}

/** The statement of a call of the mocked `$queryRaw`, with every value it binds. */
function statementOf(call: readonly unknown[] | undefined): Prisma.Sql {
  const [strings, ...values] = call ?? [];
  return Prisma.sql(strings as readonly string[], ...(values as Prisma.Sql[]));
}

describe('DeskService.list', () => {
  it('reads a week from today by default, narrowed as asked, with its total', async () => {
    const { service, db, audit, conditionOf, inPractice } = setUp();
    db.$queryRaw.mockResolvedValueOnce([{ id: ID }]).mockResolvedValueOnce([{ total: 12n }]);
    const page = await inPractice(() =>
      service.list(ACTOR, { limit: 20, providerId: PROVIDER, query: 'Sami' }, undefined),
    );
    expect(page).toMatchObject({
      from: '2026-11-15',
      to: '2026-11-21',
      total: 12,
      nextCursor: null,
    });
    expect(page.items).toHaveLength(1);
    // The patients the search finds are a condition of the same statement, not a list of ids.
    expect(conditionOf).toHaveBeenCalledWith(expect.objectContaining({ words: ['sami'] }));
    const statement = statementOf(db.$queryRaw.mock.calls[0]);
    expect(statement.sql).toContain("p.search_name <> ''");
    // From midnight in Riyadh, which is 21:00 UTC the day before, for seven days.
    expect(statement.values).toEqual(
      expect.arrayContaining([
        new Date('2026-11-14T21:00:00Z'),
        new Date('2026-11-21T21:00:00Z'),
        PROVIDER,
        21,
      ]),
    );
    expect(db.appointment.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: { in: [ID] } },
    });
    expect(audit.recordEachUnlessRecent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'appointment.list', subjectIds: [ID] }),
    );
  });

  it('counts only on the first page, so that no count comes without a row shown', async () => {
    const { service, db, inPractice } = setUp();
    db.$queryRaw.mockResolvedValueOnce([]);
    const cursor = Buffer.from(ID).toString('base64url');
    const page = await inPractice(() => service.list(ACTOR, { limit: 20, cursor }, undefined));
    expect(page).toMatchObject({ items: [], total: null, nextCursor: null });
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(statementOf(db.$queryRaw.mock.calls[0]).values).toEqual(
      expect.arrayContaining([DETAIL.slot.startsAt, ID]),
    );
  });

  it('refuses a span of more than 92 days, or one that runs backwards', async () => {
    const { service, inPractice } = setUp();
    await expect(
      inPractice(() =>
        service.list(ACTOR, { limit: 20, from: '2026-01-01', to: '2026-04-03' }, undefined),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      inPractice(() =>
        service.list(ACTOR, { limit: 20, from: '2026-01-02', to: '2026-01-01' }, undefined),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('DeskService.catalog', () => {
  it('names every doctor, lists every service, and says what the practice asks of insurance', async () => {
    const { service, db, inPractice } = setUp();
    db.practiceSettings.findUniqueOrThrow.mockResolvedValueOnce({
      // A type the API does not know stays out, so the answer keeps to its enum.
      insuranceTypes: ['PUBLIC', 'SELF_PAY', 'SOMETHING_NEW'],
      insuranceProviderTypes: ['PUBLIC'],
      insuranceNumberTypes: ['PUBLIC'],
    });
    await expect(inPractice(() => service.catalog())).resolves.toEqual({
      providers: [{ id: PROVIDER, name: 'Dr. Lina Example' }],
      services: [{ id: 'service', name: { en: 'Check-up' }, durationMinutes: 30, active: true }],
      insurance: {
        types: ['PUBLIC', 'SELF_PAY'],
        providerTypes: ['PUBLIC'],
        numberTypes: ['PUBLIC'],
      },
    });
  });
});

describe('DeskService.week', () => {
  it('shows a doctor’s week with the appointments that hold its times, and audits them', async () => {
    const { service, db, audit, inPractice } = setUp();
    db.slot.findMany.mockResolvedValueOnce([
      {
        ...ROW.slot,
        status: 'BOOKED',
        appointments: [
          {
            id: ID,
            status: 'BOOKED',
            patient: { firstName: 'Sami', lastName: 'Beispiel' },
            service: { name: { en: 'Check-up' } },
          },
        ],
      },
      {
        startsAt: new Date('2026-11-15T09:30:00Z'),
        endsAt: new Date('2026-11-15T10:00:00Z'),
        status: 'OPEN',
        appointments: [],
      },
    ]);
    db.availabilityException.findMany.mockResolvedValueOnce([
      {
        startsAt: new Date('2026-11-16T05:00:00Z'),
        endsAt: new Date('2026-11-16T07:00:00Z'),
        reason: 'TRAINING',
      },
    ]);
    const week = await inPractice(() =>
      service.week(ACTOR, { providerId: PROVIDER.toUpperCase() }, '203.0.113.1'),
    );
    expect(week).toMatchObject({
      from: '2026-11-15',
      to: '2026-11-21',
      today: '2026-11-15',
      now: '2026-11-15T07:00:00Z',
      providerId: PROVIDER,
      timeZone: 'Asia/Riyadh',
      absences: [
        { startsAt: '2026-11-16T05:00:00Z', endsAt: '2026-11-16T07:00:00Z', reason: 'TRAINING' },
      ],
    });
    expect(week.truncated).toBe(false);
    expect(week.slots).toEqual([
      expect.objectContaining({
        startsAt: '2026-11-15T09:00:00Z',
        status: 'BOOKED',
        // Who, what and its status, and no more: W6 reads the rest by the id.
        appointment: {
          id: ID,
          patient: { firstName: 'Sami', lastName: 'Beispiel' },
          serviceName: { en: 'Check-up' },
          status: 'BOOKED',
        },
      }),
      expect.objectContaining({
        startsAt: '2026-11-15T09:30:00Z',
        status: 'OPEN',
        appointment: null,
      }),
    ]);
    // Seven days from midnight in Riyadh, which is 21:00 UTC the day before.
    expect(db.slot.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        providerId: PROVIDER,
        startsAt: { gte: new Date('2026-11-14T21:00:00Z'), lt: new Date('2026-11-21T21:00:00Z') },
        // A free time without a rule is history, bookable for nothing.
        NOT: { status: 'OPEN', ruleId: null },
      },
      take: WEEK_SLOT_LIMIT + 1,
    });
    expect(audit.recordEachUnlessRecent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'appointment.list', subjectIds: [ID] }),
    );
  });

  it('stops at the limit of a week and says so', async () => {
    const { service, db, inPractice } = setUp();
    const free = {
      startsAt: new Date('2026-11-15T09:30:00Z'),
      endsAt: new Date('2026-11-15T10:00:00Z'),
      status: 'OPEN',
      appointments: [],
    };
    db.slot.findMany.mockResolvedValueOnce(Array.from({ length: WEEK_SLOT_LIMIT + 1 }, () => free));
    const week = await inPractice(() => service.week(ACTOR, { providerId: PROVIDER }, undefined));
    expect(week.slots).toHaveLength(WEEK_SLOT_LIMIT);
    expect(week.truncated).toBe(true);
  });

  it('refuses a week of a year that no practice has', async () => {
    const { service, inPractice } = setUp();
    for (const from of ['0000-01-01', '1899-12-31', '2200-01-01']) {
      await expect(
        inPractice(() => service.week(ACTOR, { providerId: PROVIDER, from }, undefined)),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('answers 404 for no doctor of the practice', async () => {
    const { service, db, inPractice } = setUp();
    db.staffMember.findFirst.mockResolvedValueOnce(null);
    await expect(
      inPractice(() =>
        service.week(ACTOR, { providerId: PROVIDER, from: '2026-11-22' }, undefined),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DeskService.book', () => {
  it('books through the patient booking with the team’s rules, and answers the row of the desk', async () => {
    const { service, bookAsPractice, inPractice } = setUp();
    const input = { patientId: PATIENT, serviceId: 'service', startsAt: '2026-11-15T09:00:00Z' };
    const key = '00000000-0000-4000-8000-0000000000ee';
    const row = await inPractice(() => service.book(ACTOR, input, key, '203.0.113.1'));
    expect(bookAsPractice).toHaveBeenCalledWith(ACTOR, input, key, '203.0.113.1');
    expect(row).toMatchObject({ id: ID, status: 'BOOKED', providerName: 'Dr. Lina Example' });
  });
});

describe('DeskService.day', () => {
  it('reads today in the practice, with counts, free times and an audit row per appointment', async () => {
    const { service, db, audit, inPractice } = setUp();
    const day = await inPractice(() => service.day(ACTOR, {}, '203.0.113.1'));
    expect(day).toMatchObject({
      date: '2026-11-15',
      today: '2026-11-15',
      timeZone: 'Asia/Riyadh',
      counts: { booked: 3, checkedIn: 0, completed: 0, noShow: 0, cancelled: 1 },
      openTimes: 4,
      nextOpenAt: '2026-11-15T10:00:00Z',
      truncated: false,
    });
    expect(day.items).toEqual([
      expect.objectContaining({
        id: ID,
        providerName: 'Dr. Lina Example',
        bookedOnline: true,
        day: 'TODAY',
        started: false,
        actions: ['CHECK_IN', 'CANCEL'],
      }),
    ]);
    // Free times from now on, and from midnight in Riyadh, which is 21:00 UTC the day before.
    expect(db.appointment.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        slot: {
          startsAt: {
            gte: new Date('2026-11-14T21:00:00Z'),
            lt: new Date('2026-11-15T21:00:00Z'),
          },
        },
      },
    });
    expect(db.slot.count.mock.calls[0]?.[0]).toMatchObject({
      where: { status: 'OPEN', startsAt: { gte: new Date(NOW.epochMilliseconds) } },
    });
    expect(audit.recordEachUnlessRecent).toHaveBeenCalledWith({
      userId: STAFF_USER,
      action: 'appointment.list',
      subjectIds: [ID],
      ipHash: 'ip-hash',
      minutes: 5,
    });
  });

  it('reads another day from its midnight, and a day without appointments names nobody', async () => {
    const { service, db, inPractice } = setUp({ rows: [] });
    const day = await inPractice(() => service.day(ACTOR, { date: '2026-11-17' }, undefined));
    expect(day).toMatchObject({ date: '2026-11-17', today: '2026-11-15', items: [] });
    expect(db.staffMember.findMany).not.toHaveBeenCalled();
    expect(db.slot.count.mock.calls[0]?.[0]).toMatchObject({
      where: { startsAt: { gte: new Date('2026-11-16T21:00:00Z') } },
    });
  });

  it('stops at its limit and says so', async () => {
    const many = Array.from({ length: DESK_DAY_LIMIT + 1 }, () => ROW);
    const { service, inPractice } = setUp({ rows: many });
    const day = await inPractice(() => service.day(ACTOR, {}, undefined));
    expect(day.items).toHaveLength(DESK_DAY_LIMIT);
    expect(day.truncated).toBe(true);
  });

  it('refuses a date that has the form of one and is none', async () => {
    const { service, inPractice } = setUp();
    await expect(
      inPractice(() => service.day(ACTOR, { date: '2026-02-31' }, undefined)),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('DeskService.appointment', () => {
  it('opens the note, names the account and audits the read', async () => {
    const { service, audit, inPractice } = setUp();
    const view = await inPractice(() => service.appointment(ACTOR, ID.toUpperCase(), undefined));
    expect(view).toMatchObject({
      id: ID,
      patientNote: 'Synthetic note',
      cancelReason: null,
      bookedAt: '2026-11-14T15:00:00Z',
      timeZone: 'Asia/Riyadh',
      patient: {
        dateOfBirth: '1990-04-12',
        age: 36,
        phone: '+966 50 000 0000',
        email: 'patient@example.test',
      },
    });
    expect(audit.record).toHaveBeenCalledWith({
      userId: STAFF_USER,
      action: 'appointment.read',
      subjectId: ID,
      ipHash: 'ip-hash',
    });
  });

  it('names no address for a profile without an account, and opens a reason of the practice', async () => {
    const cancelled = {
      ...DETAIL,
      status: 'CANCELLED',
      cancelledAt: new Date('2026-11-15T06:00:00Z'),
      cancelReasonEncrypted: 'sealed-reason',
      patientNoteEncrypted: null,
      patient: { ...DETAIL.patient, userId: null },
    };
    const { service, platform, inPractice } = setUp({ detail: cancelled });
    const view = await inPractice(() => service.appointment(ACTOR, ID, undefined));
    expect(view).toMatchObject({
      patientNote: null,
      cancelReason: 'Synthetic reason',
      cancelledByPractice: true,
      bookedOnline: false,
      actions: [],
      patient: { email: null },
    });
    expect(platform.user.findUnique).not.toHaveBeenCalled();
  });

  it('answers 404 for what is no appointment here', async () => {
    const { service, inPractice } = setUp({ detail: null });
    await expect(inPractice(() => service.appointment(ACTOR, ID, undefined))).rejects.toMatchObject(
      {
        code: 'NOT_FOUND',
      },
    );
    await expect(
      inPractice(() => service.appointment(ACTOR, 'nope', undefined)),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('DeskService changes', () => {
  it('checks in under the patient lock and audits the change', async () => {
    const { service, db, audit, inPractice } = setUp();
    await inPractice(() => service.change(ACTOR, ID, 'CHECK_IN', undefined));
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.appointment.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: { status: 'CHECKED_IN', checkedInAt: new Date(NOW.epochMilliseconds) },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'appointment.check_in', subjectId: ID }),
    );
  });

  it('completes and records a no-show with their own data', async () => {
    const checkedIn = setUp({ status: 'CHECKED_IN' });
    await checkedIn.inPractice(() => checkedIn.service.change(ACTOR, ID, 'COMPLETE', undefined));
    expect(checkedIn.db.appointment.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: { status: 'COMPLETED', completedAt: new Date(NOW.epochMilliseconds) },
    });
    const begun = setUp({ slotStartsAt: new Date('2026-11-15T06:00:00Z') });
    await begun.inPractice(() => begun.service.change(ACTOR, ID, 'NO_SHOW', undefined));
    expect(begun.db.appointment.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: { status: 'NO_SHOW' },
    });
  });

  it('answers a change that is there already alike, without writing, and audits the read', async () => {
    const { service, db, audit, inPractice } = setUp({ status: 'CHECKED_IN' });
    const view = await inPractice(() => service.change(ACTOR, ID, 'CHECK_IN', undefined));
    expect(view.id).toBe(ID);
    expect(db.appointment.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'appointment.list', subjectId: ID }),
    );
  });

  it('refuses a cancel of what the patient cancelled or moved, and repeats its own', async () => {
    const byPatient = setUp({ status: 'CANCELLED' });
    await expect(
      byPatient.inPractice(() =>
        byPatient.service.cancel(ACTOR, ID, 'Synthetic reason', undefined),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    const byPractice = setUp({ status: 'CANCELLED', cancelReasonEncrypted: 'sealed-reason' });
    const view = await byPractice.inPractice(() =>
      byPractice.service.cancel(ACTOR, ID, 'Another reason', undefined),
    );
    expect(view.id).toBe(ID);
    expect(byPractice.db.appointment.update).not.toHaveBeenCalled();
  });

  it('refuses what the matrix does not allow, and an unknown appointment', async () => {
    const early = setUp();
    await expect(
      early.inPractice(() => early.service.change(ACTOR, ID, 'NO_SHOW', undefined)),
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    expect(early.db.appointment.update).not.toHaveBeenCalled();
    const gone = setUp({ detail: null });
    await expect(
      gone.inPractice(() => gone.service.change(ACTOR, ID, 'CHECK_IN', undefined)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('cancels with a sealed reason and frees the time', async () => {
    const { service, db, encrypt, audit, inPractice } = setUp();
    await inPractice(() => service.cancel(ACTOR, ID, 'Synthetic reason', undefined));
    expect(encrypt).toHaveBeenCalledWith(
      'practice-a',
      'Synthetic reason',
      `appointment:${ID}:cancel-reason`,
    );
    expect(db.appointment.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(NOW.epochMilliseconds),
        cancelledById: STAFF_USER,
        cancelReasonEncrypted: 'sealed-reason',
      },
    });
    expect(db.slot.updateMany).toHaveBeenCalledWith({
      where: { id: SLOT, status: 'BOOKED' },
      data: { status: 'OPEN' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'appointment.cancel_by_practice' }),
    );
  });
});

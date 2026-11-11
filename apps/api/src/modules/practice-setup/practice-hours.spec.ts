import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../common/context/request-context.js';
import type { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { FixedClock } from '../../common/time/fixed-clock.js';
import type { Env } from '../../config/env.schema.js';
import { PracticeHours } from './practice-hours.js';

const cls = ClsServiceManager.getClsService<RequestContext>();
/** 10:00 in Riyadh on Sunday 15 November 2026. */
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const ACTOR = { userId: '00000000-0000-4000-8000-000000000001', sessionId: 's', amr: ['pwd'] };
const DAY_ID = '00000000-0000-4000-8000-0000000000aa';
const SETTINGS = {
  timeZone: 'Asia/Riyadh',
  numberingSystem: 'latn',
  hourCycle: 'h23',
  supportedLocales: ['ar', 'en'],
  weekStart: 7,
  weekendDays: [5, 6],
};
const DAY = {
  id: DAY_ID,
  date: new Date('2026-11-19T00:00:00Z'),
  closed: false,
  opensAt: 540,
  closesAt: 1440,
  label: { en: 'Team training' },
};

/** A failure of the database as the pg driver adapter reports it. */
function failure(code: string, sqlState: string): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('failed', {
    code,
    clientVersion: '7.10.1',
    meta: { driverAdapterError: { cause: { kind: 'postgres', originalCode: sqlState } } },
  });
}

function setUp({ deleted = 1 } = {}) {
  const db = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    practiceSettings: { findUniqueOrThrow: vi.fn().mockResolvedValue(SETTINGS) },
    openingHours: {
      findMany: vi.fn().mockResolvedValue([{ weekday: 7, opensAt: 480, closesAt: 960 }]),
      deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
      create: vi.fn().mockResolvedValue({ id: 'row' }),
    },
    specialDay: {
      findMany: vi.fn().mockResolvedValue([DAY]),
      create: vi.fn().mockResolvedValue(DAY),
      deleteMany: vi.fn().mockResolvedValue({ count: deleted }),
    },
  };
  const audit = {
    record: vi.fn().mockResolvedValue(undefined),
    ipHashOf: vi.fn().mockResolvedValue(null),
  };
  const txHost = {
    tx: db,
    withTransaction: <T>(work: () => Promise<T>): Promise<T> => work(),
  } as unknown as PracticeTransactionHost;
  const hours = new PracticeHours(
    { DATABASE_LOCK_TIMEOUT_MS: 3000 } as Env,
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
        staff: { membershipId: 'membership', role: 'STAFF', providerId: null },
      });
      return work();
    });
  return { hours, db, audit, inPractice };
}

const MONDAY = { weekday: 1, opensAt: '08:00', closesAt: '12:00' };

describe('PracticeHours.week and replaceWeek', () => {
  it('answers the week as times of the wall clock, with how the practice writes them', async () => {
    const { hours } = setUp();
    expect(await hours.week()).toEqual({
      intervals: [{ weekday: 7, opensAt: '08:00', closesAt: '16:00' }],
      weekStart: 7,
      weekendDays: [5, 6],
      timeZone: 'Asia/Riyadh',
      numberingSystem: 'latn',
      hourCycle: 'h23',
    });
  });

  it('replaces the week under a lock, in the order given, and audits it once', async () => {
    const { hours, db, audit, inPractice } = setUp();
    await inPractice(() =>
      hours.replaceWeek(
        ACTOR,
        { intervals: [{ weekday: 1, opensAt: '16:00', closesAt: '24:00' }, MONDAY] },
        undefined,
      ),
    );
    // The wait for the lock ends after the lock timeout, set in this transaction only.
    expect(db.$executeRaw.mock.calls[0]?.slice(1)).toEqual(['3000ms']);
    expect(String(db.$executeRaw.mock.calls[0]?.[0])).toContain("set_config('lock_timeout'");
    expect(String(db.$executeRaw.mock.calls[1]?.[0])).toContain('LOCK TABLE opening_hours');
    expect(db.openingHours.deleteMany).toHaveBeenCalled();
    expect(
      db.openingHours.create.mock.calls.map(
        (call: unknown[]) => (call[0] as { data: unknown }).data,
      ),
    ).toEqual([
      { weekday: 1, opensAt: 960, closesAt: 1440 },
      { weekday: 1, opensAt: 480, closesAt: 720 },
    ]);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'opening_hours.replace', subjectId: 'practice-a' }),
    );
  });

  it('names the interval the database finds overlapping, and passes other failures on', async () => {
    const { hours, db, audit, inPractice } = setUp();
    db.openingHours.create
      .mockResolvedValueOnce({ id: 'row' })
      .mockRejectedValueOnce(failure('P2010', '23P01'));
    await expect(
      inPractice(() =>
        hours.replaceWeek(
          ACTOR,
          { intervals: [MONDAY, { ...MONDAY, opensAt: '11:00' }] },
          undefined,
        ),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ field: 'intervals[1]', code: 'OVERLAPS_EXISTING' }],
    });
    const broken = new Error('connection lost');
    db.openingHours.create.mockRejectedValueOnce(broken);
    await expect(
      inPractice(() => hours.replaceWeek(ACTOR, { intervals: [MONDAY] }, undefined)),
    ).rejects.toBe(broken);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses an interval that closes before it opens before it asks the database', async () => {
    const { hours, db, inPractice } = setUp();
    await expect(
      inPractice(() =>
        hours.replaceWeek(ACTOR, { intervals: [{ ...MONDAY, closesAt: '07:00' }] }, undefined),
      ),
    ).rejects.toMatchObject({
      fieldErrors: [{ field: 'intervals[0].closesAt', code: 'TOO_SMALL' }],
    });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('PracticeHours special days', () => {
  it('lists the days from today on the practice’s calendar', async () => {
    const { hours, db } = setUp();
    expect(await hours.specialDays()).toMatchObject({
      today: '2026-11-15',
      locales: ['ar', 'en'],
      specialDays: [
        {
          id: DAY_ID,
          date: '2026-11-19',
          closed: false,
          opensAt: '09:00',
          closesAt: '24:00',
          label: { en: 'Team training' },
        },
      ],
    });
    expect(db.specialDay.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { date: { gte: new Date('2026-11-15T00:00:00Z') } } }),
    );
  });

  it('adds a closed day without hours, with its reason, and audits it', async () => {
    const { hours, db, audit, inPractice } = setUp();
    db.specialDay.create.mockResolvedValueOnce({
      ...DAY,
      closed: true,
      opensAt: null,
      closesAt: null,
    });
    const day = await inPractice(() =>
      hours.addSpecialDay(
        ACTOR,
        { date: '2026-11-19', closed: true, label: { en: ' Team training ' } },
        undefined,
      ),
    );
    expect(day).toMatchObject({ closed: true, opensAt: null, closesAt: null });
    expect(db.specialDay.create).toHaveBeenCalledWith({
      data: {
        date: new Date('2026-11-19T00:00:00Z'),
        closed: true,
        opensAt: null,
        closesAt: null,
        label: { en: 'Team training' },
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'special_day.create', subjectId: DAY_ID }),
    );
  });

  it('adds a day with other hours, and no reason', async () => {
    const { hours, db, inPractice } = setUp();
    await inPractice(() =>
      hours.addSpecialDay(
        ACTOR,
        { date: '2026-11-19', closed: false, opensAt: '09:00', closesAt: '24:00' },
        undefined,
      ),
    );
    expect(db.specialDay.create.mock.calls[0]?.[0]).toMatchObject({
      data: { opensAt: 540, closesAt: 1440, label: {} },
    });
  });

  it('answers ALREADY_EXISTS for a date that has one, and passes other failures on', async () => {
    const { hours, db, inPractice } = setUp();
    db.specialDay.create.mockRejectedValueOnce(failure('P2002', '23505'));
    await expect(
      inPractice(() => hours.addSpecialDay(ACTOR, { date: '2026-11-19', closed: true }, undefined)),
    ).rejects.toMatchObject({ fieldErrors: [{ field: 'date', code: 'ALREADY_EXISTS' }] });
    db.specialDay.create.mockRejectedValueOnce(failure('P2010', '40001'));
    await expect(
      inPractice(() => hours.addSpecialDay(ACTOR, { date: '2026-11-19', closed: true }, undefined)),
    ).rejects.toBeInstanceOf(PrismaClientKnownRequestError);
  });

  it('refuses a past day, a missing time and a reason in another language', async () => {
    const { hours, db, inPractice } = setUp();
    await expect(
      inPractice(() =>
        hours.addSpecialDay(
          ACTOR,
          { date: '2026-11-14', closed: false, opensAt: '09:00', label: { de: 'Schulung' } },
          undefined,
        ),
      ),
    ).rejects.toMatchObject({
      fieldErrors: [
        { field: 'date', code: 'TOO_SMALL' },
        { field: 'closesAt', code: 'REQUIRED' },
        { field: 'label.de', code: 'UNKNOWN_FIELD' },
      ],
    });
    expect(db.specialDay.create).not.toHaveBeenCalled();
  });

  it('removes a day once, audited, and answers NOT_FOUND after', async () => {
    const { hours, audit, inPractice } = setUp();
    await inPractice(() => hours.removeSpecialDay(ACTOR, DAY_ID, undefined));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'special_day.delete', subjectId: DAY_ID }),
    );
    await expect(
      inPractice(() => hours.removeSpecialDay(ACTOR, 'not-a-uuid', undefined)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const gone = setUp({ deleted: 0 });
    await expect(
      gone.inPractice(() => gone.hours.removeSpecialDay(ACTOR, DAY_ID, undefined)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

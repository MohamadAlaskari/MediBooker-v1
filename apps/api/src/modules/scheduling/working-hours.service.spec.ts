import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../common/context/request-context.js';
import type { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { FixedClock } from '../../common/time/fixed-clock.js';
import type { Env } from '../../config/env.schema.js';
import type { SlotGenerationService } from './slot-generation.service.js';
import { WorkingHours } from './working-hours.service.js';

const cls = ClsServiceManager.getClsService<RequestContext>();
/** 10:00 in Riyadh on Sunday 15 November 2026. */
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const ACTOR = { userId: '00000000-0000-4000-8000-000000000001', sessionId: 's', amr: ['pwd'] };
const DOCTOR = '00000000-0000-4000-8000-0000000000d1';
const OTHER = '00000000-0000-4000-8000-0000000000d2';
const SERVICE = '00000000-0000-4000-8000-0000000000aa';
const SLOT = '00000000-0000-4000-8000-0000000000ee';
const ABSENCE = '00000000-0000-4000-8000-0000000000ab';
const SETTINGS = {
  timeZone: 'Asia/Riyadh',
  numberingSystem: 'latn',
  hourCycle: 'h23',
  weekStart: 7,
};
const WEEK = {
  slotMinutes: 20,
  intervals: [{ weekday: 3, startsAt: '08:00', endsAt: '09:00' }],
  serviceIds: [SERVICE],
};

function setUp({
  role = 'STAFF',
  providerId = null,
  slotStatus = 'OPEN',
  deleted = 1,
}: {
  readonly role?: 'STAFF' | 'DOCTOR' | 'ADMIN';
  readonly providerId?: string | null;
  readonly slotStatus?: string;
  readonly deleted?: number;
} = {}) {
  const db = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([{ status: slotStatus }]),
    practiceSettings: { findUniqueOrThrow: vi.fn().mockResolvedValue(SETTINGS) },
    staffMember: { findFirst: vi.fn().mockResolvedValue({ id: DOCTOR }) },
    service: { findMany: vi.fn().mockResolvedValue([{ id: SERVICE }]) },
    availabilityRule: {
      findMany: vi.fn().mockResolvedValue([
        {
          weekday: 7,
          startMinute: 540,
          endMinute: 780,
          slotMinutes: 30,
          services: [{ serviceId: SERVICE }],
        },
        { weekday: 7, startMinute: 540, endMinute: 780, slotMinutes: 30, services: [] },
        {
          weekday: 1,
          startMinute: 960,
          endMinute: 1440,
          slotMinutes: 15,
          services: [{ serviceId: 'b' }],
        },
      ]),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: 'rule' }),
    },
    slot: {
      count: vi.fn().mockResolvedValue(12),
      findFirst: vi.fn().mockResolvedValue({ startsAt: new Date('2026-12-31T10:00:00Z') }),
      deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({ providerId: DOCTOR }),
      update: vi.fn().mockResolvedValue({ id: SLOT }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: SLOT,
        providerId: DOCTOR,
        startsAt: new Date('2026-11-16T06:00:00Z'),
        endsAt: new Date('2026-11-16T06:30:00Z'),
        status: 'BLOCKED',
      }),
    },
    availabilityException: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: ABSENCE,
          startsAt: new Date('2026-11-18T21:00:00Z'),
          endsAt: new Date('2026-11-19T21:00:00Z'),
          reason: 'TRAINING',
        },
      ]),
      create: vi.fn().mockResolvedValue({
        id: ABSENCE,
        startsAt: new Date('2026-11-16T05:00:00Z'),
        endsAt: new Date('2026-11-16T09:00:00Z'),
        reason: 'OTHER',
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: deleted }),
    },
    appointment: { count: vi.fn().mockResolvedValue(2) },
  };
  const audit = {
    record: vi.fn().mockResolvedValue(undefined),
    ipHashOf: vi.fn().mockResolvedValue('ip-hash'),
  };
  const generation = {
    generate: vi.fn().mockResolvedValue({ created: 4, removed: 1 }),
    generateFor: vi.fn().mockResolvedValue({ created: 2, removed: 0 }),
  };
  const txHost = {
    tx: db,
    withTransaction: <T>(work: () => Promise<T>): Promise<T> => work(),
  } as unknown as PracticeTransactionHost;
  const schedule = new WorkingHours(
    { DATABASE_LOCK_TIMEOUT_MS: 3000 } as Env,
    txHost,
    cls,
    new FixedClock(NOW),
    audit as unknown as PracticeAudit,
    generation as unknown as SlotGenerationService,
  );
  const inPractice = <T>(work: () => Promise<T>) =>
    cls.run(() => {
      cls.set('practice', {
        practice: { id: 'practice-a', market: 'SA', routeVersion: 1, schemaVersion: 'v' },
        lease: {} as never,
        staff: { membershipId: 'membership', role, providerId },
      });
      return work();
    });
  return { schedule, db, audit, generation, inPractice };
}

describe('WorkingHours.week', () => {
  it('shows each interval once, the most common start times, the services and the free times', async () => {
    const { schedule, inPractice } = setUp();
    expect(await inPractice(() => schedule.week(DOCTOR))).toEqual({
      ...SETTINGS,
      today: '2026-11-15',
      providerId: DOCTOR,
      slotMinutes: 30,
      intervals: [
        { weekday: 7, startsAt: '09:00', endsAt: '13:00' },
        { weekday: 1, startsAt: '16:00', endsAt: '24:00' },
      ],
      serviceIds: [SERVICE, 'b'].toSorted(),
      booking: { freeTimes: 12, openUntil: '2026-12-31' },
    });
  });

  it('has no start times and no last day for a doctor without rules or free times', async () => {
    const { schedule, db, inPractice } = setUp();
    db.availabilityRule.findMany.mockResolvedValueOnce([]);
    db.slot.findFirst.mockResolvedValueOnce(null);
    expect(await inPractice(() => schedule.week(DOCTOR))).toMatchObject({
      slotMinutes: null,
      intervals: [],
      booking: { openUntil: null },
    });
  });

  it('lets a doctor see only itself, and nobody a doctor that is none', async () => {
    const own = setUp({ role: 'DOCTOR', providerId: DOCTOR });
    await expect(own.inPractice(() => own.schedule.week(OTHER))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(own.inPractice(() => own.schedule.week(DOCTOR))).resolves.toMatchObject({
      providerId: DOCTOR,
    });
    const unlinked = setUp({ role: 'DOCTOR' });
    await expect(unlinked.inPractice(() => unlinked.schedule.week(DOCTOR))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const staff = setUp();
    await expect(staff.inPractice(() => staff.schedule.week('not-a-uuid'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    staff.db.staffMember.findFirst.mockResolvedValueOnce(null);
    await expect(staff.inPractice(() => staff.schedule.week(OTHER))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('WorkingHours.replaceWeek', () => {
  it('ends the rules of before, starts new ones today, makes the free times anew and audits it', async () => {
    const { schedule, db, audit, generation, inPractice } = setUp();
    await inPractice(() => schedule.replaceWeek(ACTOR, DOCTOR, WEEK, undefined));
    expect(db.$executeRaw.mock.calls[0]?.slice(1)).toEqual(['3000ms']);
    expect(db.availabilityRule.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        providerId: DOCTOR,
        validFrom: { lt: new Date('2026-11-15T00:00:00Z') },
      }) as unknown,
      data: { validTo: new Date('2026-11-14T00:00:00Z') },
    });
    expect(db.availabilityRule.create).toHaveBeenCalledWith({
      data: {
        providerId: DOCTOR,
        weekday: 3,
        startMinute: 480,
        endMinute: 540,
        slotMinutes: 20,
        validFrom: new Date('2026-11-15T00:00:00Z'),
        services: { create: [{ serviceId: SERVICE }] },
      },
      select: { id: true },
    });
    expect(db.slot.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.slot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ruleId: null } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'working_hours.replace', subjectId: DOCTOR }),
    );
    // Only the doctor the change is about, not every doctor (security review of M04).
    expect(generation.generateFor).toHaveBeenCalledExactlyOnceWith(DOCTOR);
    expect(generation.generate).not.toHaveBeenCalled();
  });

  it('refuses an overlap, an unknown service and hours without services, and writes nothing', async () => {
    const { schedule, db, inPractice } = setUp();
    db.service.findMany.mockResolvedValueOnce([]);
    await expect(
      inPractice(() =>
        schedule.replaceWeek(
          ACTOR,
          DOCTOR,
          {
            slotMinutes: 30,
            intervals: [
              { weekday: 1, startsAt: '08:00', endsAt: '12:00' },
              { weekday: 1, startsAt: '11:00', endsAt: '13:00' },
            ],
            serviceIds: [SERVICE],
          },
          undefined,
        ),
      ),
    ).rejects.toMatchObject({
      fieldErrors: [
        { field: 'intervals[1]', code: 'OVERLAPS_EXISTING' },
        { field: 'serviceIds[0]', code: 'INVALID_VALUE' },
      ],
    });
    await expect(
      inPractice(() => schedule.replaceWeek(ACTOR, DOCTOR, { ...WEEK, serviceIds: [] }, undefined)),
    ).rejects.toMatchObject({ fieldErrors: [{ field: 'serviceIds', code: 'REQUIRED' }] });
    expect(db.availabilityRule.create).not.toHaveBeenCalled();
  });
});

describe('WorkingHours absences', () => {
  it('lists the absences not over, whole days marked', async () => {
    const { schedule, inPractice } = setUp();
    expect(await inPractice(() => schedule.absences(DOCTOR))).toMatchObject({
      absences: [
        {
          id: ABSENCE,
          startsAt: '2026-11-18T21:00:00Z',
          endsAt: '2026-11-19T21:00:00Z',
          reason: 'TRAINING',
          allDay: true,
        },
      ],
    });
  });

  it('adds a time of one day, counts the booked appointments in it, and makes the free times anew', async () => {
    const { schedule, db, audit, generation, inPractice } = setUp();
    const added = await inPractice(() =>
      schedule.addAbsence(
        ACTOR,
        DOCTOR,
        {
          startDate: '2026-11-16',
          endDate: '2026-11-16',
          startTime: '08:00',
          endTime: '12:00',
          reason: 'OTHER',
        },
        undefined,
      ),
    );
    expect(added).toEqual({
      id: ABSENCE,
      startsAt: '2026-11-16T05:00:00Z',
      endsAt: '2026-11-16T09:00:00Z',
      reason: 'OTHER',
      allDay: false,
      bookedInside: 2,
    });
    expect(db.availabilityException.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          providerId: DOCTOR,
          startsAt: new Date('2026-11-16T05:00:00Z'),
          endsAt: new Date('2026-11-16T09:00:00Z'),
          reason: 'OTHER',
        },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'absence.create', subjectId: ABSENCE }),
    );
    // Only the doctor the change is about, not every doctor (security review of M04).
    expect(generation.generateFor).toHaveBeenCalledExactlyOnceWith(DOCTOR);
    expect(generation.generate).not.toHaveBeenCalled();
  });

  it('refuses an absence that is over', async () => {
    const { schedule, db, inPractice } = setUp();
    await expect(
      inPractice(() =>
        schedule.addAbsence(
          ACTOR,
          DOCTOR,
          { startDate: '2026-11-10', endDate: '2026-11-12', reason: 'VACATION' },
          undefined,
        ),
      ),
    ).rejects.toMatchObject({ fieldErrors: [{ field: 'endDate', code: 'TOO_SMALL' }] });
    expect(db.availabilityException.create).not.toHaveBeenCalled();
  });

  it('removes an absence once, and answers NOT_FOUND after', async () => {
    const { schedule, audit, generation, inPractice } = setUp();
    await inPractice(() => schedule.removeAbsence(ACTOR, DOCTOR, ABSENCE, undefined));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'absence.delete', subjectId: ABSENCE }),
    );
    // Only the doctor the change is about, not every doctor (security review of M04).
    expect(generation.generateFor).toHaveBeenCalledExactlyOnceWith(DOCTOR);
    expect(generation.generate).not.toHaveBeenCalled();
    await expect(
      inPractice(() => schedule.removeAbsence(ACTOR, DOCTOR, 'not-a-uuid', undefined)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const gone = setUp({ deleted: 0 });
    await expect(
      gone.inPractice(() => gone.schedule.removeAbsence(ACTOR, DOCTOR, ABSENCE, undefined)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('WorkingHours.generate and changeSlot', () => {
  it('makes the free times anew and audits it', async () => {
    const { schedule, audit, inPractice } = setUp();
    expect(await inPractice(() => schedule.generate(ACTOR, undefined))).toEqual({
      created: 4,
      removed: 1,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'slots.generate', subjectId: 'practice-a' }),
    );
  });

  it('blocks a free time and audits it, and answers a retry alike without a write', async () => {
    const { schedule, db, audit, inPractice } = setUp();
    const changed = await inPractice(() =>
      schedule.changeSlot(ACTOR, SLOT, { status: 'BLOCKED' }, undefined),
    );
    expect(changed).toMatchObject({ id: SLOT, status: 'BLOCKED', providerId: DOCTOR });
    expect(db.slot.update).toHaveBeenCalledWith({
      where: { id: SLOT },
      data: { status: 'BLOCKED' },
      select: { id: true },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'slot.block', subjectId: SLOT }),
    );
    const again = setUp({ slotStatus: 'BLOCKED' });
    await again.inPractice(() =>
      again.schedule.changeSlot(ACTOR, SLOT, { status: 'BLOCKED' }, undefined),
    );
    expect(again.db.slot.update).not.toHaveBeenCalled();
    const freed = setUp({ slotStatus: 'BLOCKED' });
    await freed.inPractice(() =>
      freed.schedule.changeSlot(ACTOR, SLOT, { status: 'OPEN' }, undefined),
    );
    expect(freed.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'slot.unblock' }),
    );
    // A freed time without a rule gets one again when the doctor's week wants it.
    expect(freed.generation.generateFor).toHaveBeenCalledExactlyOnceWith(DOCTOR);
    expect(again.generation.generateFor).not.toHaveBeenCalled();
  });

  it('runs one change of a doctor at a time and once more for the changes meanwhile', async () => {
    const { schedule, generation, inPractice } = setUp();
    let finish: () => void = () => undefined;
    generation.generateFor.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve({ created: 0, removed: 0 });
          };
        }),
    );
    const first = inPractice(() => schedule.removeAbsence(ACTOR, DOCTOR, ABSENCE, undefined));
    await vi.waitFor(() => {
      expect(generation.generateFor).toHaveBeenCalledTimes(1);
    });
    // Two changes while the run is under way: neither waits for it, and they share one more run.
    await inPractice(() => schedule.removeAbsence(ACTOR, DOCTOR, ABSENCE, undefined));
    await inPractice(() => schedule.removeAbsence(ACTOR, DOCTOR, ABSENCE, undefined));
    expect(generation.generateFor).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(generation.generateFor).toHaveBeenCalledTimes(2);
  });

  it('runs one generation of every doctor at a time per practice', async () => {
    const { schedule, generation, inPractice } = setUp();
    let finish: () => void = () => undefined;
    generation.generate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve({ created: 0, removed: 0 });
          };
        }),
    );
    const first = inPractice(() => schedule.generate(ACTOR, undefined));
    await vi.waitFor(() => {
      expect(generation.generate).toHaveBeenCalledTimes(1);
    });
    await expect(inPractice(() => schedule.generate(ACTOR, undefined))).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    finish();
    await first;
  });

  it('refuses a time an appointment holds, and one that is none or another doctor’s', async () => {
    const booked = setUp({ slotStatus: 'BOOKED' });
    await expect(
      booked.inPractice(() =>
        booked.schedule.changeSlot(ACTOR, SLOT, { status: 'BLOCKED' }, undefined),
      ),
    ).rejects.toMatchObject({ code: 'SLOT_HAS_APPOINTMENT' });
    const none = setUp();
    await expect(
      none.inPractice(() =>
        none.schedule.changeSlot(ACTOR, 'not-a-uuid', { status: 'OPEN' }, undefined),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    none.db.slot.findUnique.mockResolvedValueOnce(null);
    await expect(
      none.inPractice(() => none.schedule.changeSlot(ACTOR, SLOT, { status: 'OPEN' }, undefined)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    none.db.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      none.inPractice(() => none.schedule.changeSlot(ACTOR, SLOT, { status: 'OPEN' }, undefined)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const other = setUp({ role: 'DOCTOR', providerId: OTHER });
    await expect(
      other.inPractice(() =>
        other.schedule.changeSlot(ACTOR, SLOT, { status: 'BLOCKED' }, undefined),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

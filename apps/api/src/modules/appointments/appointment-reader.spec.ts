import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../common/context/request-context.js';
import { encodeCursor } from '../../common/http/cursor-page.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { FixedClock } from '../../common/time/fixed-clock.js';
import { AppointmentReader } from './appointment-reader.js';
import type { AppointmentListQueryDto } from './appointments.dto.js';

const cls = ClsServiceManager.getClsService<RequestContext>();
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const SELF = '00000000-0000-4000-8000-0000000000aa';
const PROVIDER = '00000000-0000-4000-8000-0000000000cc';
const ID = '00000000-0000-4000-8000-0000000000dd';

const row = (id = ID) => ({
  id,
  patientId: SELF,
  serviceId: 'service',
  status: 'BOOKED',
  bookedAt: new Date(NOW.epochMilliseconds),
  service: { name: { ar: 'فحص', en: 'Check-up' } },
  slot: {
    providerId: PROVIDER,
    startsAt: new Date('2026-11-17T07:00:00Z'),
    endsAt: new Date('2026-11-17T07:30:00Z'),
  },
});

function setUp() {
  const db = {
    appointment: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(row()),
      findFirst: vi.fn().mockResolvedValue(row()),
      findMany: vi.fn().mockResolvedValue([row()]),
    },
    patient: { findFirst: vi.fn().mockResolvedValue({ id: SELF }) },
    practiceSettings: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ timeZone: 'Asia/Riyadh', cancellationDeadlineHours: 24 }),
    },
    staffMember: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: PROVIDER, title: 'Dr.', firstName: 'Sara', lastName: 'Beispiel' },
        ]),
    },
  };
  const reader = new AppointmentReader(
    { tx: db } as unknown as PracticeTransactionHost,
    cls,
    new FixedClock(NOW),
  );
  const inPractice = <T>(work: () => Promise<T>, selfPatientId: string | null = SELF) =>
    cls.run(() => {
      cls.set('practice', {
        practice: { id: 'practice-a', market: 'SA', routeVersion: 1, schemaVersion: 'v' },
        lease: {} as never,
        ...(selfPatientId === null ? {} : { selfPatientId }),
      });
      return work();
    });
  return { reader, db, inPractice };
}

const query = (values: Partial<AppointmentListQueryDto> = {}): AppointmentListQueryDto => ({
  scope: 'upcoming',
  limit: 20,
  ...values,
});

describe('AppointmentReader', () => {
  it('says what a person needs to know', async () => {
    const { reader, inPractice } = setUp();
    await expect(inPractice(() => reader.read(ID))).resolves.toEqual({
      id: ID,
      practiceId: 'practice-a',
      patientId: SELF,
      serviceId: 'service',
      serviceName: { ar: 'فحص', en: 'Check-up' },
      providerId: PROVIDER,
      providerName: 'Dr. Sara Beispiel',
      startsAt: '2026-11-17T07:00:00Z',
      endsAt: '2026-11-17T07:30:00Z',
      timeZone: 'Asia/Riyadh',
      status: 'BOOKED',
      bookedAt: NOW.toString(),
      changeableUntil: '2026-11-16T07:00:00Z',
    });
  });

  it('asks for the doctor with the rule of BR-24, once for a whole list', async () => {
    const { reader, db, inPractice } = setUp();
    db.appointment.findMany.mockResolvedValue([row('a'), row('b')]);
    await inPractice(() => reader.ownPage(query()));
    expect(db.staffMember.findMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [PROVIDER] },
          isProvider: true,
          hiddenAt: null,
        }) as object,
      }),
    );
  });

  it('BR-24 names nobody without a public profile, and leaves out a missing title', async () => {
    const { reader, db, inPractice } = setUp();
    db.staffMember.findMany.mockResolvedValue([]);
    await expect(inPractice(() => reader.read(ID))).resolves.toMatchObject({
      providerId: null,
      providerName: null,
    });
    db.staffMember.findMany.mockResolvedValue([
      { id: PROVIDER, title: null, firstName: 'Sara', lastName: 'Beispiel' },
    ]);
    await expect(inPractice(() => reader.read(ID))).resolves.toMatchObject({
      providerName: 'Sara Beispiel',
    });
  });

  it('never selects the note', async () => {
    const { reader, db, inPractice } = setUp();
    await inPractice(() => reader.read(ID));
    expect(JSON.stringify(db.appointment.findUniqueOrThrow.mock.calls)).not.toContain('Note');
  });

  it('reads an own appointment by the own profile, and answers 404 for anything else', async () => {
    const { reader, db, inPractice } = setUp();
    await inPractice(() => reader.own(ID.toUpperCase()));
    expect(db.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID, patientId: SELF } }),
    );
    await expect(inPractice(() => reader.own('not-an-id'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(inPractice(() => reader.own(ID), null)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    db.appointment.findFirst.mockResolvedValue(null);
    await expect(inPractice(() => reader.own(ID))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists what is to come soonest first, and past what has ended or stopped, latest first', async () => {
    const { reader, db, inPractice } = setUp();
    await inPractice(() => reader.ownPage(query({ scope: 'upcoming' })));
    const now = new Date(NOW.epochMilliseconds);
    expect(db.appointment.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          patientId: SELF,
          AND: [{ status: { in: ['BOOKED', 'CHECKED_IN'] }, slot: { startsAt: { gt: now } } }],
        },
        orderBy: [{ slot: { startsAt: 'asc' } }, { id: 'asc' }],
        take: 21,
      }),
    );
    await inPractice(() => reader.ownPage(query({ scope: 'past' })));
    expect(db.appointment.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          patientId: SELF,
          AND: [
            {
              OR: [
                { status: { notIn: ['BOOKED', 'CHECKED_IN'] } },
                { slot: { startsAt: { lte: now } } },
              ],
            },
          ],
        },
        orderBy: [{ slot: { startsAt: 'desc' } }, { id: 'desc' }],
      }),
    );
  });

  it('continues after a cursor, with the id deciding between equal starts', async () => {
    const { reader, db, inPractice } = setUp();
    const startsAt = new Date('2026-11-17T07:00:00Z');
    const cursor = encodeCursor(ID);
    await inPractice(() => reader.ownPage(query({ scope: 'upcoming', cursor })));
    expect(db.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID, patientId: SELF } }),
    );
    expect(db.appointment.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                { slot: { startsAt: { gt: startsAt } } },
                { slot: { startsAt }, id: { gt: ID } },
              ],
            },
          ]) as object,
        }) as object,
      }),
    );
    await inPractice(() => reader.ownPage(query({ scope: 'past', cursor })));
    expect(db.appointment.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                { slot: { startsAt: { lt: startsAt } } },
                { slot: { startsAt }, id: { lt: ID } },
              ],
            },
          ]) as object,
        }) as object,
      }),
    );
  });

  it('refuses a cursor that is no id, and one that is not an appointment of this patient', async () => {
    const { reader, db, inPractice } = setUp();
    await expect(
      inPractice(() => reader.ownPage(query({ cursor: encodeCursor('anything') }))),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    db.appointment.findFirst.mockResolvedValue(null);
    await expect(
      inPractice(() => reader.ownPage(query({ cursor: encodeCursor(ID) }))),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(db.appointment.findMany).not.toHaveBeenCalled();
  });

  it('gives the next cursor only when more follows, and answers an empty list without asking more', async () => {
    const { reader, db, inPractice } = setUp();
    db.appointment.findMany.mockResolvedValue([row('a'), row('b')]);
    const page = await inPractice(() => reader.ownPage(query({ limit: 1 })));
    expect(page.items.map(({ id }) => id)).toEqual(['a']);
    expect(page.nextCursor).toBe(encodeCursor('a'));
    db.appointment.findMany.mockResolvedValue([]);
    db.practiceSettings.findUniqueOrThrow.mockClear();
    await expect(inPractice(() => reader.ownPage(query()))).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(db.practiceSettings.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('answers 404 for a page without an own profile', async () => {
    const { reader, inPractice } = setUp();
    await expect(inPractice(() => reader.ownPage(query()), null)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('asks the practice database who the patient is: a stale index row finds nothing', async () => {
    const { reader, db, inPractice } = setUp();
    await expect(inPractice(() => reader.upcomingOfAccount('user'), null)).resolves.toHaveLength(1);
    expect(db.patient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user', relationship: 'SELF' } }),
    );
    db.patient.findFirst.mockResolvedValue(null);
    await expect(inPractice(() => reader.upcomingOfAccount('user'), null)).resolves.toEqual([]);
  });
});

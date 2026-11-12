import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../common/context/request-context.js';
import type { AccountTransactions } from '../../common/tenancy/account-transactions.js';
import type { PracticeAudit, PracticeAuditEntry } from '../../common/tenancy/practice-audit.js';
import type { PracticeKeys } from '../../common/tenancy/practice-keys.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { FixedClock } from '../../common/time/fixed-clock.js';
import type { AppointmentReader } from './appointment-reader.js';
import { AppointmentsService } from './appointments.service.js';
import type { TimeHolds } from './time-holds.js';

const cls = ClsServiceManager.getClsService<RequestContext>();
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const USER = '00000000-0000-4000-8000-000000000001';
const SELF = '00000000-0000-4000-8000-0000000000aa';
const SERVICE = '00000000-0000-4000-8000-0000000000bb';
const PROVIDER = '00000000-0000-4000-8000-0000000000cc';
const SLOT = '00000000-0000-4000-8000-0000000000dd';
const KEY = '00000000-0000-4000-8000-0000000000ee';
const OLD = '00000000-0000-4000-8000-0000000000ff';
const OLD_SLOT = '00000000-0000-4000-8000-000000000011';
const ACTOR = { userId: USER, sessionId: 'session', amr: ['pwd'] };
const STARTS_AT = '2026-11-16T07:00:00Z';
/** The end of a visit of the service's 30 minutes from STARTS_AT (BR-27). */
const VISIT_END = '2026-11-16T07:30:00Z';
const SETTINGS = {
  minLeadTimeMinutes: 120,
  maxHorizonDays: 90,
  maxFutureAppointmentsPerPatient: 2,
  cancellationDeadlineHours: 24,
  insuranceTypes: ['PUBLIC', 'SELF_PAY'],
  insuranceProviderTypes: ['PUBLIC'],
  insuranceNumberTypes: ['PUBLIC'],
};
const SELF_PAYER = { insurance_type: 'SELF_PAY', insurance_provider: null, number_known: false };
const INPUT = { serviceId: SERVICE, startsAt: STARTS_AT };
/** An appointment two days ahead: before BR-04's deadline. */
const OLD_ROW = {
  id: OLD,
  status: 'BOOKED',
  slotId: OLD_SLOT,
  serviceId: SERVICE,
  slot: { startsAt: new Date('2026-11-17T07:00:00Z') },
  rescheduledTo: null,
};
const VIEW = { id: 'view' };

/** The answers of $queryRaw in their order: the key's row, the patient; `slot`: a free time. */
function setUp({
  stored = { request_hash: 'hash', appointment_id: null },
  patient = SELF_PAYER,
  slot = { id: SLOT },
  row = OLD_ROW,
}: {
  readonly stored?: object | null;
  readonly patient?: object | null;
  readonly slot?: object | null;
  readonly row?: object | null;
} = {}) {
  const db = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce(stored === null ? [] : [stored])
      .mockResolvedValueOnce(patient === null ? [] : [patient]),
    $executeRaw: vi.fn().mockResolvedValue(1),
    practiceSettings: { findUniqueOrThrow: vi.fn().mockResolvedValue(SETTINGS) },
    service: {
      findUnique: vi.fn().mockResolvedValue({
        active: true,
        isBookableOnline: true,
        allowedInsuranceTypes: [],
        durationMinutes: 30,
        bufferMinutes: 10,
      }),
    },
    staffMember: { findFirst: vi.fn().mockResolvedValue({ id: PROVIDER }) },
    appointment: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(row),
    },
    slot: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    idempotencyKey: { update: vi.fn().mockResolvedValue({}) },
  };
  const txHost = { tx: db } as unknown as PracticeTransactionHost;
  const run = vi.fn(<T>(_userId: string, work: () => Promise<T>): Promise<T> => work());
  const encrypt = vi.fn().mockResolvedValue('sealed-note');
  const decrypt = vi.fn().mockResolvedValue('Synthetic');
  const keyedHash = vi.fn().mockResolvedValue('hash');
  const keys = { encrypt, decrypt, keyedHash } as unknown as PracticeKeys;
  const record = vi.fn<(entry: PracticeAuditEntry) => Promise<void>>().mockResolvedValue(undefined);
  const audit = {
    record,
    ipHashOf: vi.fn().mockResolvedValue('ip-hash'),
  } as unknown as PracticeAudit;
  const read = vi.fn().mockResolvedValue(VIEW);
  const holds = {
    take: vi.fn().mockResolvedValue(
      slot === null
        ? undefined
        : {
            slotId: SLOT,
            providerId: PROVIDER,
            heldIds: [SLOT],
            visitEnd: Temporal.Instant.from(VISIT_END),
          },
    ),
    hold: vi.fn().mockResolvedValue(undefined),
    lockHeld: vi.fn().mockResolvedValue(undefined),
  };
  const service = new AppointmentsService(
    txHost,
    { run } as unknown as AccountTransactions,
    { read } as unknown as AppointmentReader,
    cls,
    new FixedClock(NOW),
    keys,
    audit,
    holds as unknown as TimeHolds,
  );
  const inPractice = <T>(work: () => Promise<T>) =>
    cls.run(() => {
      cls.set('practice', {
        practice: { id: 'practice-a', market: 'SA', routeVersion: 1, schemaVersion: 'v' },
        lease: {} as never,
        selfPatientId: SELF,
      });
      return work();
    });
  const outside = <T>(work: () => Promise<T>) =>
    cls.run(() => {
      cls.set('practice', {
        practice: { id: 'practice-a', market: 'SA', routeVersion: 1, schemaVersion: 'v' },
        lease: {} as never,
      });
      return work();
    });
  return {
    service,
    db,
    holds,
    run,
    read,
    encrypt,
    decrypt,
    keyedHash,
    record,
    inPractice,
    outside,
  };
}

describe('AppointmentsService.book', () => {
  it('takes the time, books it for the own profile, remembers the key and audits it', async () => {
    const context = setUp();
    const dto = await context.inPractice(() => context.service.book(ACTOR, INPUT, KEY, 'x'));
    // The service's duration and buffer (BR-27), for the doctor's time.
    expect(context.holds.take.mock.calls[0]?.[0]).toMatchObject({
      serviceId: SERVICE,
      startsAt: Temporal.Instant.from(STARTS_AT),
      length: { durationMinutes: 30, bufferMinutes: 10 },
    });
    const { data } = context.db.appointment.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(context.holds.hold).toHaveBeenCalledWith([SLOT], data.id);
    expect(data).toMatchObject({
      patientId: SELF,
      slotId: SLOT,
      endsAt: new Date(VISIT_END),
      serviceId: SERVICE,
      status: 'BOOKED',
      patientNoteEncrypted: null,
      bookedById: USER,
    });
    expect(context.db.idempotencyKey.update).toHaveBeenCalledWith({
      where: { actorId_key: { actorId: USER, key: KEY } },
      data: { appointmentId: data.id },
    });
    expect(context.record).toHaveBeenCalledWith({
      userId: USER,
      action: 'appointment.book',
      subjectId: data.id,
      ipHash: 'ip-hash',
    });
    expect(context.read).toHaveBeenCalledWith(data.id);
    expect(dto).toBe(VIEW);
  });

  it('seals a note for this row, and hashes the request with a key of the practice', async () => {
    const context = setUp();
    await context.inPractice(() =>
      context.service.book(ACTOR, { ...INPUT, patientNote: 'Synthetic' }, KEY, 'x'),
    );
    const { data } = context.db.appointment.create.mock.calls[0]?.[0] as {
      data: { id: string; patientNoteEncrypted: string };
    };
    expect(data.patientNoteEncrypted).toBe('sealed-note');
    expect(context.encrypt).toHaveBeenCalledWith(
      'practice-a',
      'Synthetic',
      `appointment:${data.id}:patient-note`,
    );
    expect(context.keyedHash).toHaveBeenCalledWith(
      'practice-a',
      'idempotency-request',
      expect.stringContaining('Synthetic') as string,
    );
  });

  it('reads the same instant from another spelling, for the same key', async () => {
    const context = setUp();
    await context.inPractice(() =>
      context.service.book(
        ACTOR,
        { serviceId: SERVICE.toUpperCase(), startsAt: '2026-11-16T10:00:00+03:00' },
        KEY.toUpperCase(),
        'x',
      ),
    );
    expect(context.keyedHash).toHaveBeenCalledWith(
      'practice-a',
      'idempotency-request',
      JSON.stringify([SERVICE, '2026-11-16T07:00:00Z', null, null]),
    );
  });

  it('answers a replay with the first booking, without taking a lock on anything else', async () => {
    const context = setUp({ stored: { request_hash: 'hash', appointment_id: 'first' } });
    await context.inPractice(() => context.service.book(ACTOR, INPUT, KEY, 'x'));
    expect(context.read).toHaveBeenCalledWith('first');
    expect(context.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(context.db.appointment.create).not.toHaveBeenCalled();
  });

  it.each([
    ['another request', { stored: { request_hash: 'other', appointment_id: null } }],
    ['a row that went away', { stored: null }],
  ])('refuses a key with %s', async (_, options) => {
    const context = setUp(options);
    await expect(
      context.inPractice(() => context.service.book(ACTOR, INPUT, KEY, 'x')),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it.each([
    [undefined, 'REQUIRED'],
    ['not-a-uuid', 'INVALID_VALUE'],
  ])('needs a key that is a UUID: %j', async (key, code) => {
    const context = setUp();
    await expect(
      context.inPractice(() => context.service.book(ACTOR, INPUT, key, 'x')),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ field: 'Idempotency-Key', code }],
    });
  });

  it('refuses what is no time', async () => {
    const context = setUp();
    await expect(
      context.inPractice(() =>
        context.service.book(ACTOR, { ...INPUT, startsAt: '2026-02-31T10:00:00Z' }, KEY, 'x'),
      ),
    ).rejects.toMatchObject({ fieldErrors: [{ field: 'startsAt', code: 'INVALID_VALUE' }] });
  });

  it('answers 404 without an own profile, and when it went away', async () => {
    const context = setUp();
    await expect(
      context.outside(() => context.service.book(ACTOR, INPUT, KEY, 'x')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const gone = setUp({ patient: null });
    await expect(
      gone.inPractice(() => gone.service.book(ACTOR, INPUT, KEY, 'x')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a time outside the window', async () => {
    const context = setUp();
    await expect(
      context.inPractice(() =>
        context.service.book(ACTOR, { ...INPUT, startsAt: '2026-11-15T08:00:00Z' }, KEY, 'x'),
      ),
    ).rejects.toMatchObject({ code: 'OUTSIDE_BOOKING_WINDOW' });
  });

  it('refuses a service that is gone or not bookable', async () => {
    const context = setUp();
    context.db.service.findUnique.mockResolvedValue(null);
    await expect(
      context.inPractice(() => context.service.book(ACTOR, INPUT, KEY, 'x')),
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_BOOKABLE' });
  });

  it('BR-25 refuses a time that overlaps an own appointment, and books nothing', async () => {
    const context = setUp();
    // The first count is BR-02's, which leaves a place; the second is this rule's.
    context.db.appointment.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    await expect(
      context.inPractice(() => context.service.book(ACTOR, INPUT, KEY, 'x')),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_OVERLAP' });
    expect(context.db.appointment.count).toHaveBeenLastCalledWith({
      where: {
        patientId: SELF,
        status: { in: ['BOOKED', 'CHECKED_IN'] },
        // The visit, not the buffer: that is the doctor's time, not the person's.
        endsAt: { gt: new Date(INPUT.startsAt) },
        slot: { startsAt: { lt: new Date(VISIT_END) } },
      },
    });
    expect(context.holds.hold).not.toHaveBeenCalled();
    expect(context.db.appointment.create).not.toHaveBeenCalled();
  });

  it('BR-25 names the own appointment also when no slot is free', async () => {
    const context = setUp({ slot: null });
    context.db.appointment.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    await expect(
      context.inPractice(() => context.service.book(ACTOR, INPUT, KEY, 'x')),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_OVERLAP' });
  });

  it('books in a transaction of this account', async () => {
    const context = setUp();
    await context.inPractice(() => context.service.book(ACTOR, INPUT, KEY, 'x'));
    expect(context.run).toHaveBeenCalledWith(USER, expect.any(Function));
  });

  it('refuses a doctor named without a public profile, and asks only when one is named', async () => {
    const context = setUp();
    await context.inPractice(() => context.service.book(ACTOR, INPUT, KEY, 'x'));
    expect(context.db.staffMember.findFirst).not.toHaveBeenCalled();

    const named = setUp();
    named.db.staffMember.findFirst.mockResolvedValue(null);
    await expect(
      named.inPractice(() =>
        named.service.book(ACTOR, { ...INPUT, providerId: PROVIDER }, KEY, 'x'),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(named.db.appointment.create).not.toHaveBeenCalled();
  });

  it.each([
    ['a type the practice no longer takes', { ...SELF_PAYER, insurance_type: 'PRIVATE' }],
    [
      'a number the practice now asks for',
      { insurance_type: 'PUBLIC', insurance_provider: 'Synthetic', number_known: false },
    ],
    [
      'a provider the practice now asks for',
      { insurance_type: 'PUBLIC', insurance_provider: null, number_known: true },
    ],
  ])('asks for the details first: %s (BR-09)', async (_, patient) => {
    const context = setUp({ patient });
    await expect(
      context.inPractice(() => context.service.book(ACTOR, INPUT, KEY, 'x')),
    ).rejects.toMatchObject({ code: 'PATIENT_PROFILE_INCOMPLETE' });
    expect(context.db.appointment.create).not.toHaveBeenCalled();
  });

  it('names the limit it stopped at', async () => {
    const context = setUp();
    context.db.appointment.count.mockResolvedValue(2);
    await expect(
      context.inPractice(() => context.service.book(ACTOR, INPUT, KEY, 'x')),
    ).rejects.toMatchObject({
      code: 'BOOKING_LIMIT_REACHED',
      params: { maxFutureAppointments: 2 },
    });
  });

  it('refuses a time without a free slot', async () => {
    const context = setUp({ slot: null });
    await expect(
      context.inPractice(() => context.service.book(ACTOR, INPUT, KEY, 'x')),
    ).rejects.toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
    expect(context.db.appointment.create).not.toHaveBeenCalled();
  });

  it('turns the index of BR-01 into the same answer, and passes on anything else', async () => {
    const context = setUp();
    context.db.appointment.create.mockRejectedValue(
      new PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(
      context.inPractice(() => context.service.book(ACTOR, INPUT, KEY, 'x')),
    ).rejects.toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });

    const down = setUp();
    down.db.appointment.create.mockRejectedValue(new Error('down'));
    await expect(down.inPractice(() => down.service.book(ACTOR, INPUT, KEY, 'x'))).rejects.toThrow(
      'down',
    );
  });
});

describe('AppointmentsService.bookAsPractice (BR-02 for the team)', () => {
  const PATIENT = '00000000-0000-4000-8000-0000000000a1';
  const DESK_INPUT = { patientId: PATIENT, serviceId: SERVICE, startsAt: STARTS_AT };
  const REASON = 'Synthetic: a follow-up the doctor asked for';

  it('books within the limit as before, and keeps no reason it was given', async () => {
    const context = setUp();
    const id = await context.inPractice(() =>
      context.service.bookAsPractice(
        ACTOR,
        { ...DESK_INPUT, limitOverrideReason: REASON },
        KEY,
        'x',
      ),
    );
    const { data } = context.db.appointment.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data.id).toBe(id);
    expect(data.limitOverrideReasonEncrypted).toBeNull();
    expect(context.record).toHaveBeenCalledWith({
      userId: USER,
      action: 'appointment.book_by_practice',
      subjectId: id,
      ipHash: 'ip-hash',
    });
  });

  it('refuses past the limit without a reason, and books nothing', async () => {
    const context = setUp();
    context.db.appointment.count.mockResolvedValueOnce(2);
    await expect(
      context.inPractice(() => context.service.bookAsPractice(ACTOR, DESK_INPUT, KEY, 'x')),
    ).rejects.toMatchObject({
      code: 'BOOKING_LIMIT_REACHED',
      params: { maxFutureAppointments: 2 },
    });
    expect(context.holds.take).not.toHaveBeenCalled();
    expect(context.db.appointment.create).not.toHaveBeenCalled();
  });

  it('books past the limit with the reason sealed for this row, and audits it apart', async () => {
    const context = setUp();
    context.db.appointment.count.mockResolvedValueOnce(2);
    const id = await context.inPractice(() =>
      context.service.bookAsPractice(
        ACTOR,
        { ...DESK_INPUT, limitOverrideReason: REASON },
        KEY,
        'x',
      ),
    );
    expect(context.encrypt).toHaveBeenCalledWith(
      'practice-a',
      REASON,
      `appointment:${id}:limit-override-reason`,
    );
    const { data } = context.db.appointment.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({ id, limitOverrideReasonEncrypted: 'sealed-note' });
    expect(context.record).toHaveBeenCalledWith({
      userId: USER,
      action: 'appointment.book_by_practice_over_limit',
      subjectId: id,
      ipHash: 'ip-hash',
    });
    // The reason is part of the request: a key sent again with another one is another request.
    const [, , hashed] = context.keyedHash.mock.calls.find(
      ([, purpose]) => purpose === 'idempotency-request',
    ) as [string, string, string];
    expect(JSON.parse(hashed)).toContain(REASON);
  });
});

describe('AppointmentsService.cancel', () => {
  it('BR-04 cancels with who and when, frees the slot and audits it', async () => {
    const context = setUp({ stored: SELF_PAYER, patient: null });
    await expect(
      context.inPractice(() => context.service.cancel(ACTOR, OLD.toUpperCase(), 'x')),
    ).resolves.toBe(VIEW);
    expect(context.db.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: OLD, patientId: SELF } }),
    );
    expect(context.db.appointment.update).toHaveBeenCalledWith({
      where: { id: OLD },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(NOW.epochMilliseconds),
        cancelledById: USER,
      },
    });
    // Its slots locked in order first: the database frees its whole time with the cancel (BR-27).
    expect(context.holds.lockHeld).toHaveBeenCalledWith(OLD);
    const locked = context.holds.lockHeld.mock.invocationCallOrder[0] ?? 0;
    const cancelled = context.db.appointment.update.mock.invocationCallOrder[0] ?? 0;
    expect(locked).toBeLessThan(cancelled);
    expect(context.record).toHaveBeenCalledWith({
      userId: USER,
      action: 'appointment.cancel',
      subjectId: OLD,
      ipHash: 'ip-hash',
    });
    expect(context.run).toHaveBeenCalledWith(USER, expect.any(Function));
  });

  it('changes nothing for what is cancelled already, whenever that is', async () => {
    const context = setUp({
      stored: SELF_PAYER,
      row: {
        ...OLD_ROW,
        status: 'CANCELLED',
        slot: { startsAt: new Date('2026-11-01T07:00:00Z') },
      },
    });
    await expect(context.inPractice(() => context.service.cancel(ACTOR, OLD, 'x'))).resolves.toBe(
      VIEW,
    );
    expect(context.db.appointment.update).not.toHaveBeenCalled();
    expect(context.record).not.toHaveBeenCalled();
  });

  it('refuses a row that was moved: the new appointment still stands', async () => {
    const context = setUp({
      stored: SELF_PAYER,
      row: { ...OLD_ROW, status: 'CANCELLED', rescheduledTo: { id: 'new' } },
    });
    await expect(
      context.inPractice(() => context.service.cancel(ACTOR, OLD, 'x')),
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    expect(context.db.appointment.update).not.toHaveBeenCalled();
  });

  it('BR-04 refuses after the deadline, and names it', async () => {
    const context = setUp({
      stored: SELF_PAYER,
      row: { ...OLD_ROW, slot: { startsAt: new Date('2026-11-16T06:59:00Z') } },
    });
    await expect(
      context.inPractice(() => context.service.cancel(ACTOR, OLD, 'x')),
    ).rejects.toMatchObject({
      code: 'CANCELLATION_DEADLINE_PASSED',
      params: { cancellationDeadlineHours: 24 },
    });
    expect(context.db.appointment.update).not.toHaveBeenCalled();
  });

  it('refuses what has moved on', async () => {
    const context = setUp({ stored: SELF_PAYER, row: { ...OLD_ROW, status: 'CHECKED_IN' } });
    await expect(
      context.inPractice(() => context.service.cancel(ACTOR, OLD, 'x')),
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
  });

  it('answers 404 for no own profile, for what is no id, and for what is not there', async () => {
    const none = setUp();
    await expect(none.outside(() => none.service.cancel(ACTOR, OLD, 'x'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const noId = setUp();
    await expect(
      noId.inPractice(() => noId.service.cancel(ACTOR, 'not-an-id', 'x')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const gone = setUp({ stored: SELF_PAYER, row: null });
    await expect(gone.inPractice(() => gone.service.cancel(ACTOR, OLD, 'x'))).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    expect(gone.db.appointment.update).not.toHaveBeenCalled();
  });
});

describe('AppointmentsService.reschedule (BR-05)', () => {
  const MOVE = { startsAt: STARTS_AT };

  it('takes the new time before it frees the old one, and links the new row to the old', async () => {
    const context = setUp();
    context.db.appointment.findFirst
      .mockResolvedValueOnce({ patientNoteEncrypted: null })
      .mockResolvedValueOnce(OLD_ROW);
    await expect(
      context.inPractice(() => context.service.reschedule(ACTOR, OLD, MOVE, KEY, 'x')),
    ).resolves.toBe(VIEW);
    // The old time's slots locked first, then the new time taken, then the old one cancelled.
    const locked = context.holds.lockHeld.mock.invocationCallOrder[0] ?? 0;
    const taken = context.holds.take.mock.invocationCallOrder[0] ?? 0;
    const freed = context.db.appointment.update.mock.invocationCallOrder[0] ?? 0;
    expect(context.holds.lockHeld).toHaveBeenCalledWith(OLD);
    expect(locked).toBeLessThan(taken);
    expect(taken).toBeLessThan(freed);
    // The old time counts as free, its start does not.
    expect(context.holds.take.mock.calls[0]?.[0]).toMatchObject({
      moving: { id: OLD, slotId: OLD_SLOT },
    });
    expect(context.holds.hold).toHaveBeenCalledWith([SLOT], expect.any(String));
    const { data } = context.db.appointment.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({
      patientId: SELF,
      slotId: SLOT,
      serviceId: SERVICE,
      rescheduledFromId: OLD,
    });
    expect(context.db.appointment.update).toHaveBeenCalledWith({
      where: { id: OLD },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(NOW.epochMilliseconds),
        cancelledById: USER,
        patientNoteEncrypted: null,
      },
    });
    expect(context.record.mock.calls.map(([entry]) => [entry.action, entry.subjectId])).toEqual([
      ['appointment.cancel', OLD],
      ['appointment.reschedule', data.id],
    ]);
    // BR-02 has nothing to count; BR-25 asks once, without the appointment being moved.
    expect(context.db.appointment.count).toHaveBeenCalledExactlyOnceWith({
      where: expect.objectContaining({ id: { not: OLD } }) as unknown,
    });
  });

  it('keeps the note, sealed for the new row', async () => {
    const context = setUp();
    context.db.appointment.findFirst
      .mockResolvedValueOnce({ patientNoteEncrypted: 'old-seal' })
      .mockResolvedValueOnce(OLD_ROW);
    await context.inPractice(() => context.service.reschedule(ACTOR, OLD, MOVE, KEY, 'x'));
    const { data } = context.db.appointment.create.mock.calls[0]?.[0] as {
      data: { id: string; patientNoteEncrypted: string };
    };
    expect(context.decrypt).toHaveBeenCalledWith(
      'practice-a',
      'old-seal',
      `appointment:${OLD}:patient-note`,
    );
    expect(context.encrypt).toHaveBeenCalledWith(
      'practice-a',
      'Synthetic',
      `appointment:${data.id}:patient-note`,
    );
    expect(data.patientNoteEncrypted).toBe('sealed-note');
  });

  it('hashes a request of its own: a key of a booking does not fit', async () => {
    const context = setUp();
    context.db.appointment.findFirst
      .mockResolvedValueOnce({ patientNoteEncrypted: null })
      .mockResolvedValueOnce(OLD_ROW);
    await context.inPractice(() =>
      context.service.reschedule(ACTOR, OLD, { ...MOVE, providerId: PROVIDER }, KEY, 'x'),
    );
    expect(context.keyedHash).toHaveBeenCalledWith(
      'practice-a',
      'idempotency-request',
      JSON.stringify(['reschedule', OLD, STARTS_AT, PROVIDER]),
    );
  });

  it('answers a replay with the new appointment, and cancels nothing again', async () => {
    const context = setUp({ stored: { request_hash: 'hash', appointment_id: 'new' } });
    context.db.appointment.findFirst.mockResolvedValueOnce({ patientNoteEncrypted: null });
    await context.inPractice(() => context.service.reschedule(ACTOR, OLD, MOVE, KEY, 'x'));
    expect(context.read).toHaveBeenCalledWith('new');
    expect(context.db.appointment.update).not.toHaveBeenCalled();
  });

  it('leaves the old appointment alone when no new slot is free', async () => {
    const context = setUp({ slot: null });
    context.db.appointment.findFirst
      .mockResolvedValueOnce({ patientNoteEncrypted: null })
      .mockResolvedValueOnce(OLD_ROW);
    await expect(
      context.inPractice(() => context.service.reschedule(ACTOR, OLD, MOVE, KEY, 'x')),
    ).rejects.toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
    expect(context.db.appointment.update).not.toHaveBeenCalled();
  });

  it('answers 404 for no own profile, for what is no id, and for what is not own', async () => {
    const none = setUp();
    await expect(
      none.outside(() => none.service.reschedule(ACTOR, OLD, MOVE, KEY, 'x')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const noId = setUp();
    await expect(
      noId.inPractice(() => noId.service.reschedule(ACTOR, 'not-an-id', MOVE, KEY, 'x')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const notOwn = setUp({ row: null });
    await expect(
      notOwn.inPractice(() => notOwn.service.reschedule(ACTOR, OLD, MOVE, KEY, 'x')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(notOwn.run).not.toHaveBeenCalled();
  });
});

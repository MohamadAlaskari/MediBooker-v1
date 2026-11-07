import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../common/context/request-context.js';
import type { AccountTransactions } from '../../common/tenancy/account-transactions.js';
import type { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import type { PracticeKeys } from '../../common/tenancy/practice-keys.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { FixedClock } from '../../common/time/fixed-clock.js';
import { AppointmentsService } from './appointments.service.js';

const cls = ClsServiceManager.getClsService<RequestContext>();
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const USER = '00000000-0000-4000-8000-000000000001';
const SELF = '00000000-0000-4000-8000-0000000000aa';
const SERVICE = '00000000-0000-4000-8000-0000000000bb';
const PROVIDER = '00000000-0000-4000-8000-0000000000cc';
const SLOT = '00000000-0000-4000-8000-0000000000dd';
const KEY = '00000000-0000-4000-8000-0000000000ee';
const ACTOR = { userId: USER, sessionId: 'session', amr: ['pwd'] };
const STARTS_AT = '2026-11-16T07:00:00Z';
const SETTINGS = {
  minLeadTimeMinutes: 120,
  maxHorizonDays: 90,
  maxFutureAppointmentsPerPatient: 2,
  insuranceTypes: ['PUBLIC', 'SELF_PAY'],
  insuranceProviderTypes: ['PUBLIC'],
  insuranceNumberTypes: ['PUBLIC'],
};
const SELF_PAYER = { insurance_type: 'SELF_PAY', insurance_provider: null, number_known: false };
const INPUT = { serviceId: SERVICE, startsAt: STARTS_AT };

/** The answers of $queryRaw in their order: the key's row, the patient, the slot. */
function setUp({
  stored = { request_hash: 'hash', appointment_id: null },
  patient = SELF_PAYER,
  slot = { id: SLOT },
}: {
  readonly stored?: object | null;
  readonly patient?: object | null;
  readonly slot?: object | null;
} = {}) {
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce(stored === null ? [] : [stored])
    .mockResolvedValueOnce(patient === null ? [] : [patient])
    .mockResolvedValueOnce(slot === null ? [] : [slot]);
  const db = {
    $queryRaw: queryRaw,
    $executeRaw: vi.fn().mockResolvedValue(1),
    practiceSettings: { findUniqueOrThrow: vi.fn().mockResolvedValue(SETTINGS) },
    service: {
      findUnique: vi.fn().mockResolvedValue({
        active: true,
        isBookableOnline: true,
        allowedInsuranceTypes: [],
      }),
    },
    staffMember: { findFirst: vi.fn().mockResolvedValue({ id: PROVIDER }) },
    appointment: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'appointment',
        patientId: SELF,
        serviceId: SERVICE,
        status: 'BOOKED',
        bookedAt: new Date(NOW.epochMilliseconds),
        slot: {
          providerId: PROVIDER,
          startsAt: new Date('2026-11-16T07:00:00Z'),
          endsAt: new Date('2026-11-16T07:30:00Z'),
        },
      }),
    },
    slot: { update: vi.fn().mockResolvedValue({}) },
    idempotencyKey: { update: vi.fn().mockResolvedValue({}) },
  };
  const txHost = { tx: db } as unknown as PracticeTransactionHost;
  const run = vi.fn(<T>(_userId: string, work: () => Promise<T>): Promise<T> => work());
  const encrypt = vi.fn().mockResolvedValue('sealed-note');
  const keyedHash = vi.fn().mockResolvedValue('hash');
  const keys = { encrypt, keyedHash } as unknown as PracticeKeys;
  const record = vi.fn().mockResolvedValue(undefined);
  const audit = {
    record,
    ipHashOf: vi.fn().mockResolvedValue('ip-hash'),
  } as unknown as PracticeAudit;
  const service = new AppointmentsService(
    txHost,
    { run } as unknown as AccountTransactions,
    cls,
    new FixedClock(NOW),
    keys,
    audit,
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
  return { service, db, run, encrypt, keyedHash, record, inPractice };
}

describe('AppointmentsService.book', () => {
  it('takes the slot, books it for the own profile, remembers the key and audits it', async () => {
    const context = setUp();
    const dto = await context.inPractice(() => context.service.book(ACTOR, INPUT, KEY, 'x'));
    expect(context.db.slot.update).toHaveBeenCalledWith({
      where: { id: SLOT },
      data: { status: 'BOOKED' },
    });
    const { data } = context.db.appointment.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({
      patientId: SELF,
      slotId: SLOT,
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
    expect(dto).toEqual({
      id: 'appointment',
      patientId: SELF,
      serviceId: SERVICE,
      providerId: PROVIDER,
      startsAt: '2026-11-16T07:00:00Z',
      endsAt: '2026-11-16T07:30:00Z',
      status: 'BOOKED',
      bookedAt: NOW.toString(),
    });
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
    expect(context.db.appointment.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'first' } }),
    );
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
      cls.run(() => {
        cls.set('practice', {
          practice: { id: 'practice-a', market: 'SA', routeVersion: 1, schemaVersion: 'v' },
          lease: {} as never,
        });
        return context.service.book(ACTOR, INPUT, KEY, 'x');
      }),
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

  it('books in a transaction of this account', async () => {
    const context = setUp();
    await context.inPractice(() => context.service.book(ACTOR, INPUT, KEY, 'x'));
    expect(context.run).toHaveBeenCalledWith(USER, expect.any(Function));
  });

  it('refuses a doctor named without a public profile', async () => {
    const context = setUp();
    context.db.staffMember.findFirst.mockResolvedValue(null);
    await expect(
      context.inPractice(() =>
        context.service.book(ACTOR, { ...INPUT, providerId: PROVIDER }, KEY, 'x'),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(context.db.appointment.create).not.toHaveBeenCalled();
  });

  it('books any doctor, and names one only with a public profile (BR-24)', async () => {
    const context = setUp();
    context.db.staffMember.findFirst.mockResolvedValue(null);
    await expect(
      context.inPractice(() => context.service.book(ACTOR, INPUT, KEY, 'x')),
    ).resolves.toMatchObject({ providerId: null });
    expect(context.db.appointment.create).toHaveBeenCalledOnce();
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

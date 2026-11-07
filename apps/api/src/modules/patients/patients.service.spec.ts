import { PRIVACY_NOTICE_VERSION } from '@medibooker/i18n';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import { fakePinoLogger } from '../../../test/support/fake-pino-logger.js';
import type { RequestContext } from '../../common/context/request-context.js';
import type { PlatformTransactionHost } from '../../common/database/platform-transactional.js';
import { SecretUnavailableError } from '../../common/database/secret-store.js';
import type { FieldCipher } from '../../common/security/field-cipher.js';
import type { IntegrationRelay } from '../../common/tenancy/integration-relay.js';
import type { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import type { PracticeKeys } from '../../common/tenancy/practice-keys.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { FixedClock } from '../../common/time/fixed-clock.js';
import { PatientsService } from './patients.service.js';

const cls = ClsServiceManager.getClsService<RequestContext>();
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
const USER = '00000000-0000-4000-8000-000000000001';
const SELF = '00000000-0000-4000-8000-0000000000aa';
const ACTOR = { userId: USER, sessionId: 'session', amr: ['pwd'] };
const RULES = {
  insuranceTypes: ['PUBLIC', 'PRIVATE', 'SELF_PAY'],
  insuranceProviderTypes: ['PUBLIC', 'PRIVATE'],
  insuranceNumberTypes: ['PUBLIC', 'PRIVATE'],
};
const PROFILE = {
  firstName: 'Sami',
  lastName: 'Beispiel',
  dateOfBirth: new Date('1990-04-12T00:00:00Z'),
  phone: '+966 50 000 0000',
  insuranceType: 'PUBLIC',
  insuranceProvider: 'Synthetic Health',
  insuranceNumberEncrypted: 'sealed-by-the-platform',
  insuranceNumberEnd: '6789',
};
const ROW = {
  id: SELF,
  firstName: 'Sami',
  lastName: 'Beispiel',
  dateOfBirth: new Date('1990-04-12T00:00:00Z'),
  contactPhone: '+966 50 000 0000',
  insuranceType: 'PUBLIC',
  insuranceProvider: 'Synthetic Health',
  insuranceNumberEnd: '6789',
  insuranceNumberEncrypted: 'sealed',
};

function uniqueViolation(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
}

function setUp(market = 'SA') {
  const practice = {
    patient: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(ROW),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    practiceSettings: { findUniqueOrThrow: vi.fn().mockResolvedValue(RULES) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const platform = {
    accountProfile: { findUnique: vi.fn().mockResolvedValue(PROFILE) },
    accountConsent: {
      findFirst: vi.fn().mockResolvedValue({ id: 'consent' }),
      create: vi.fn().mockResolvedValue({}),
    },
    practiceAccess: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    session: { findUnique: vi.fn().mockResolvedValue({ revokedAt: null }) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const inTransaction = <T>(work: () => Promise<T>): Promise<T> => work();
  const practiceTx = {
    tx: practice,
    withTransaction: inTransaction,
  } as unknown as PracticeTransactionHost;
  const platformTx = {
    tx: platform,
    withTransaction: inTransaction,
  } as unknown as PlatformTransactionHost;
  const decrypt = vi.fn().mockResolvedValue('A123456789');
  const cipher = { decrypt } as unknown as FieldCipher;
  const encrypt = vi.fn().mockResolvedValue('sealed-by-the-practice');
  const keyedHash = vi.fn().mockResolvedValue('blind-index');
  const keys = { encrypt, keyedHash } as unknown as PracticeKeys;
  const record = vi.fn().mockResolvedValue(undefined);
  const ipHashOf = vi.fn().mockResolvedValue('ip-hash');
  const audit = { record, ipHashOf } as unknown as PracticeAudit;
  const recordAccessChange = vi.fn().mockResolvedValue(7n);
  const applyNow = vi.fn().mockResolvedValue(undefined);
  const relay = { recordAccessChange, applyNow } as unknown as IntegrationRelay;
  const { logger, calls } = fakePinoLogger();
  const service = new PatientsService(
    practiceTx,
    platformTx,
    cls,
    new FixedClock(NOW),
    cipher,
    keys,
    audit,
    relay,
    logger,
  );
  /** Runs `work` with the context the interceptor sets for such a route. */
  const inPractice = <T>(work: () => Promise<T>): Promise<T> =>
    cls.run(() => {
      cls.set('practice', {
        practice: { id: 'practice-a', market, routeVersion: 1, schemaVersion: 'v' },
        lease: {} as never,
        selfPatientId: SELF,
      });
      return work();
    });
  return {
    service,
    practice,
    platform,
    decrypt,
    encrypt,
    keyedHash,
    record,
    ipHashOf,
    recordAccessChange,
    applyNow,
    calls,
    inPractice,
  };
}

function problemsOf(failure: unknown): readonly { field: string; code: string }[] {
  const { fieldErrors } = failure as { fieldErrors: { field: string; code: string }[] };
  return fieldErrors.map(({ field, code }) => ({ field, code }));
}

describe('PatientsService.join', () => {
  it('copies the details, moves the number to the key of the practice, and tells the index', async () => {
    const context = setUp();
    await context.inPractice(() => context.service.join(ACTOR, {}, '203.0.113.9'));
    expect(context.decrypt).toHaveBeenCalledWith(
      'sealed-by-the-platform',
      `account-profile:${USER}:insurance-number`,
    );
    const { data } = context.practice.patient.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({
      userId: USER,
      relationship: 'SELF',
      firstName: 'Sami',
      contactPhone: '+966 50 000 0000',
      insuranceProvider: 'Synthetic Health',
      insuranceNumberEncrypted: 'sealed-by-the-practice',
      insuranceNumberEnd: '6789',
      insuranceNumberIndex: 'blind-index',
    });
    expect(context.encrypt).toHaveBeenCalledWith(
      'practice-a',
      'A123456789',
      `patient:${String(data.id)}:insurance-number`,
    );
    expect(context.keyedHash).toHaveBeenCalledWith('practice-a', 'insurance-number', 'A123456789');
    expect(context.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, action: 'patient.join', ipHash: 'ip-hash' }),
    );
    const change = { userId: USER, capacity: 'PATIENT', active: true };
    expect(context.recordAccessChange).toHaveBeenCalledWith(change);
    expect(context.applyNow).toHaveBeenCalledWith('practice-a', 7n, change);
  });

  it('copies only what this practice asks for: the rest stays with the account', async () => {
    const context = setUp();
    context.practice.practiceSettings.findUniqueOrThrow.mockResolvedValue({
      ...RULES,
      insuranceProviderTypes: [],
      insuranceNumberTypes: [],
    });
    await context.inPractice(() => context.service.join(ACTOR, {}, undefined));
    const { data } = context.practice.patient.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({ insuranceType: 'PUBLIC', insuranceProvider: null });
    expect(data.insuranceNumberEncrypted).toBeUndefined();
    expect(context.decrypt).not.toHaveBeenCalled();
  });

  it('removes a phone the person cleared, and copies it only when left out', async () => {
    const cleared = setUp();
    await cleared.inPractice(() => cleared.service.join(ACTOR, { phone: null }, undefined));
    const { data } = cleared.practice.patient.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({ contactPhone: null });
  });

  it('holds its place before it writes, under the row lock of the account', async () => {
    const context = setUp();
    await context.inPractice(() => context.service.join(ACTOR, {}, undefined));
    expect(context.platform.$queryRaw).toHaveBeenCalledTimes(1);
    expect(context.platform.practiceAccess.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: USER, practiceId: 'practice-a', active: false })],
      skipDuplicates: true,
    });
    const reserved = context.platform.practiceAccess.createMany.mock.invocationCallOrder[0] ?? 0;
    const created = context.practice.patient.create.mock.invocationCallOrder[0] ?? 0;
    expect(reserved).toBeLessThan(created);
  });

  it('seals the number before it takes a place: without a key nothing stays behind', async () => {
    const context = setUp();
    context.encrypt.mockRejectedValue(new Error('no key'));
    await expect(
      context.inPractice(() => context.service.join(ACTOR, {}, undefined)),
    ).rejects.toThrow('no key');
    expect(context.platform.practiceAccess.createMany).not.toHaveBeenCalled();
    expect(context.platform.accountConsent.create).not.toHaveBeenCalled();
  });

  it('asks only for a consent to the current notice', async () => {
    const context = setUp();
    await context.inPractice(() => context.service.join(ACTOR, {}, undefined));
    expect(context.platform.accountConsent.findFirst).toHaveBeenCalledWith({
      where: { userId: USER, type: 'PRIVACY_NOTICE', textVersion: PRIVACY_NOTICE_VERSION },
      select: { id: true },
    });
  });

  it('looks at the session again under the lock: no join after a sign-out or a reset', async () => {
    for (const session of [{ revokedAt: new Date() }, null]) {
      const context = setUp();
      context.platform.session.findUnique.mockResolvedValue(session);
      await expect(
        context.inPractice(() => context.service.join(ACTOR, {}, undefined)),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(context.practice.patient.create).not.toHaveBeenCalled();
    }
  });

  it('asks for the number when the stored one cannot be opened, and logs no value', async () => {
    const context = setUp();
    context.decrypt.mockRejectedValue(new Error('a field value that cannot be opened'));
    const failure: unknown = await context
      .inPractice(() => context.service.join(ACTOR, {}, undefined))
      .catch((error: unknown) => error);
    expect(problemsOf(failure)).toEqual([{ field: 'insuranceNumber', code: 'REQUIRED' }]);
    expect(context.calls.map(({ message }) => message)).toEqual([
      'insurance number of an account not readable',
    ]);
  });

  it('passes on a secret store that is away, which is no fault of the person', async () => {
    const context = setUp();
    context.decrypt.mockRejectedValue(new SecretUnavailableError());
    await expect(
      context.inPractice(() => context.service.join(ACTOR, {}, undefined)),
    ).rejects.toBeInstanceOf(SecretUnavailableError);
  });

  it('answers ALREADY_JOINED, and takes no place', async () => {
    const context = setUp();
    context.practice.patient.findFirst.mockResolvedValue({ id: SELF });
    await expect(
      context.inPractice(() => context.service.join(ACTOR, {}, undefined)),
    ).rejects.toMatchObject({
      code: 'ALREADY_JOINED',
    });
    expect(context.platform.practiceAccess.createMany).not.toHaveBeenCalled();
  });

  it('turns the unique index of two joins at once into the same answer', async () => {
    const context = setUp();
    context.practice.patient.create.mockRejectedValue(uniqueViolation());
    await expect(
      context.inPractice(() => context.service.join(ACTOR, {}, undefined)),
    ).rejects.toMatchObject({
      code: 'ALREADY_JOINED',
    });
    expect(context.applyNow).not.toHaveBeenCalled();
  });

  it('passes on any other failure of the database', async () => {
    const context = setUp();
    context.practice.patient.create.mockRejectedValue(new Error('down'));
    await expect(
      context.inPractice(() => context.service.join(ACTOR, {}, undefined)),
    ).rejects.toThrow('down');
  });

  it('names all that is missing without a profile, and writes nothing', async () => {
    const context = setUp();
    context.platform.accountProfile.findUnique.mockResolvedValue(null);
    context.platform.accountConsent.findFirst.mockResolvedValue(null);
    const failure: unknown = await context
      .inPractice(() => context.service.join(ACTOR, {}, undefined))
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(problemsOf(failure)).toEqual([
      { field: 'firstName', code: 'REQUIRED' },
      { field: 'lastName', code: 'REQUIRED' },
      { field: 'dateOfBirth', code: 'REQUIRED' },
      { field: 'insuranceType', code: 'REQUIRED' },
      { field: 'privacyNoticeVersion', code: 'REQUIRED' },
    ]);
    expect(context.platform.$queryRaw).not.toHaveBeenCalled();
    expect(context.practice.patient.create).not.toHaveBeenCalled();
  });

  it('takes everything from the request when the account has no profile', async () => {
    const context = setUp();
    context.platform.accountProfile.findUnique.mockResolvedValue(null);
    await context.inPractice(() =>
      context.service.join(
        ACTOR,
        {
          firstName: 'Lina',
          lastName: 'Muster',
          dateOfBirth: '1985-01-02',
          phone: null,
          insuranceType: 'SELF_PAY',
        },
        undefined,
      ),
    );
    const { data } = context.practice.patient.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({ firstName: 'Lina', contactPhone: null, insuranceProvider: null });
    expect(data.insuranceNumberEncrypted).toBeUndefined();
    expect(context.decrypt).not.toHaveBeenCalled();
  });

  it('asks for a new number when the type changes, and copies no provider of the old one', async () => {
    const context = setUp();
    const failure: unknown = await context
      .inPractice(() => context.service.join(ACTOR, { insuranceType: 'PRIVATE' }, undefined))
      .catch((error: unknown) => error);
    expect(problemsOf(failure)).toEqual([
      { field: 'insuranceProvider', code: 'REQUIRED' },
      { field: 'insuranceNumber', code: 'REQUIRED' },
    ]);
    expect(context.decrypt).not.toHaveBeenCalled();
  });

  it('prefers a number from the request and does not open the stored one', async () => {
    const context = setUp();
    await context.inPractice(() =>
      context.service.join(ACTOR, { insuranceNumber: 'B987654321' }, undefined),
    );
    expect(context.decrypt).not.toHaveBeenCalled();
    expect(context.keyedHash).toHaveBeenCalledWith('practice-a', 'insurance-number', 'B987654321');
  });

  it('refuses a number that does not fit the market', async () => {
    const context = setUp('DE');
    context.decrypt.mockResolvedValue('NOT-THE-FORMAT');
    const failure: unknown = await context
      .inPractice(() => context.service.join(ACTOR, {}, undefined))
      .catch((error: unknown) => error);
    expect(problemsOf(failure)).toEqual([{ field: 'insuranceNumber', code: 'INVALID_VALUE' }]);
  });

  it('records a consent that is given, in the same step as the place', async () => {
    const context = setUp();
    context.platform.accountConsent.findFirst.mockResolvedValue(null);
    await context.inPractice(() =>
      context.service.join(ACTOR, { privacyNoticeVersion: '2026-11' }, undefined),
    );
    expect(context.platform.accountConsent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER,
        type: 'PRIVACY_NOTICE',
        textVersion: '2026-11',
      }) as object,
    });
  });

  it('does not record a consent twice', async () => {
    const context = setUp();
    await context.inPractice(() =>
      context.service.join(ACTOR, { privacyNoticeVersion: '2026-11' }, undefined),
    );
    expect(context.platform.accountConsent.create).not.toHaveBeenCalled();
  });

  describe('the limit of the day', () => {
    /** Places taken that long ago, the newest first, as the query answers. */
    const taken = (...ago: readonly Temporal.DurationLike[]) =>
      ago.map((duration) => ({
        createdAt: new Date(NOW.subtract(duration).epochMilliseconds),
      }));

    it('stops the sixth new practice, and counts only other practices', async () => {
      const context = setUp();
      context.platform.practiceAccess.findMany.mockResolvedValue(
        taken({ hours: 1 }, { hours: 2 }, { hours: 3 }, { hours: 4 }, { hours: 5 }),
      );
      await expect(
        context.inPractice(() => context.service.join(ACTOR, {}, undefined)),
      ).rejects.toMatchObject({ code: 'JOIN_LIMIT_REACHED' });
      expect(context.platform.practiceAccess.findMany).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: USER,
            capacity: 'PATIENT',
            practiceId: { not: 'practice-a' },
            createdAt: { gte: new Date('2026-11-14T07:00:00Z') },
          }) as object,
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
      );
      expect(context.platform.practiceAccess.createMany).not.toHaveBeenCalled();
      expect(context.practice.patient.create).not.toHaveBeenCalled();
    });

    it('takes the fifth new practice', async () => {
      const context = setUp();
      context.platform.practiceAccess.findMany.mockResolvedValue(
        taken({ hours: 1 }, { hours: 2 }, { hours: 3 }, { hours: 4 }),
      );
      await context.inPractice(() => context.service.join(ACTOR, {}, undefined));
      expect(context.practice.patient.create).toHaveBeenCalledOnce();
    });

    it.each([
      ['an hour', { hours: 23 }, 3601],
      ['half a second less', { hours: 23, milliseconds: 500 }, 3600],
      ['nothing, as its last moment counts as inside', { hours: 24 }, 1],
    ])(
      'says how long until the last of the five leaves the day: %s',
      async (_, ago, retryAfterSeconds) => {
        const context = setUp();
        context.platform.practiceAccess.findMany.mockResolvedValue(
          taken({ hours: 1 }, { hours: 2 }, { hours: 3 }, { hours: 4 }, ago),
        );
        await expect(
          context.inPractice(() => context.service.join(ACTOR, {}, undefined)),
        ).rejects.toMatchObject({ retryAfterSeconds });
      },
    );
  });

  it.each(['2026-02-31', '2030-01-01', '1800-01-01'])('refuses the birth date %s', async (date) => {
    const context = setUp();
    const failure: unknown = await context
      .inPractice(() => context.service.join(ACTOR, { dateOfBirth: date }, undefined))
      .catch((error: unknown) => error);
    expect(problemsOf(failure)).toEqual([{ field: 'dateOfBirth', code: 'INVALID_VALUE' }]);
  });
});

describe('PatientsService.mine', () => {
  it('lists the own profile', async () => {
    const context = setUp();
    const { items } = await context.inPractice(() => context.service.mine());
    expect(items.map(({ id }) => id)).toEqual([SELF]);
  });
});

describe('PatientsService.own', () => {
  it('reads the own profile, in any spelling of its id, with the number masked', async () => {
    const context = setUp();
    const dto = await context.inPractice(() => context.service.own(SELF.toUpperCase()));
    expect(dto).toEqual({
      id: SELF,
      firstName: 'Sami',
      lastName: 'Beispiel',
      dateOfBirth: '1990-04-12',
      phone: '+966 50 000 0000',
      insuranceType: 'PUBLIC',
      insuranceProvider: 'Synthetic Health',
      insuranceNumberEnd: '6789',
    });
  });

  it('answers 404 for anyone else, without reading', async () => {
    const context = setUp();
    await expect(context.inPractice(() => context.service.own('another'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(context.practice.patient.findUnique).not.toHaveBeenCalled();
  });

  it('answers 404 when the row is gone', async () => {
    const context = setUp();
    context.practice.patient.findUnique.mockResolvedValue(null);
    await expect(context.inPractice(() => context.service.own(SELF))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('PatientsService.update', () => {
  const dataOf = (mock: ReturnType<typeof vi.fn>): Record<string, unknown> =>
    (mock.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;

  it('changes what is given and nothing else, and does not read the rules for it', async () => {
    const context = setUp();
    await context.inPractice(() =>
      context.service.update(ACTOR, SELF, { firstName: 'Samira', phone: null }, 'x'),
    );
    expect(dataOf(context.practice.patient.update)).toEqual({
      firstName: 'Samira',
      contactPhone: null,
    });
    expect(context.practice.practiceSettings.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(context.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'patient.update', subjectId: SELF }),
    );
  });

  it('decides under the lock of the row, on what the row says then', async () => {
    const context = setUp();
    await context.inPractice(() =>
      context.service.update(ACTOR, SELF, { insuranceProvider: 'Other' }, 'x'),
    );
    const locked = context.practice.$queryRaw.mock.invocationCallOrder[0] ?? 0;
    const read = context.practice.patient.findUnique.mock.invocationCallOrder[0] ?? 0;
    const written = context.practice.patient.update.mock.invocationCallOrder[0] ?? 0;
    expect(locked).toBeLessThan(read);
    expect(read).toBeLessThan(written);
  });

  it('keeps no number for a self-payer, also when one is sent', async () => {
    const context = setUp();
    context.practice.patient.findUnique.mockResolvedValue({
      ...ROW,
      insuranceType: 'SELF_PAY',
      insuranceProvider: null,
      insuranceNumberEncrypted: null,
    });
    await context.inPractice(() =>
      context.service.update(ACTOR, SELF, { insuranceNumber: 'B987654321' }, 'x'),
    );
    const data = (
      context.practice.patient.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    ).data;
    expect(data).toEqual({ insuranceType: 'SELF_PAY', insuranceProvider: null });
  });

  it('takes last name and birth date', async () => {
    const context = setUp();
    await context.inPractice(() =>
      context.service.update(ACTOR, SELF, { lastName: 'Neu', dateOfBirth: '1991-02-03' }, 'x'),
    );
    expect(dataOf(context.practice.patient.update)).toEqual({
      lastName: 'Neu',
      dateOfBirth: new Date('1991-02-03T00:00:00Z'),
    });
  });

  it('seals a new number again, for the same row', async () => {
    const context = setUp();
    await context.inPractice(() =>
      context.service.update(ACTOR, SELF, { insuranceNumber: 'B987654321' }, 'x'),
    );
    expect(context.encrypt).toHaveBeenCalledWith(
      'practice-a',
      'B987654321',
      `patient:${SELF}:insurance-number`,
    );
    expect(dataOf(context.practice.patient.update)).toMatchObject({
      insuranceNumberEnd: '4321',
      insuranceNumberIndex: 'blind-index',
    });
  });

  it('keeps the known number when only the provider changes', async () => {
    const context = setUp();
    await context.inPractice(() =>
      context.service.update(ACTOR, SELF, { insuranceProvider: 'Other' }, 'x'),
    );
    const data = dataOf(context.practice.patient.update);
    expect(data).toMatchObject({ insuranceType: 'PUBLIC', insuranceProvider: 'Other' });
    expect(data).not.toHaveProperty('insuranceNumberEncrypted');
  });

  it('forgets the number of the old type', async () => {
    const context = setUp();
    await context.inPractice(() =>
      context.service.update(ACTOR, SELF, { insuranceType: 'SELF_PAY' }, 'x'),
    );
    expect(dataOf(context.practice.patient.update)).toEqual({
      insuranceType: 'SELF_PAY',
      insuranceProvider: null,
      insuranceNumberEncrypted: null,
      insuranceNumberEnd: null,
      insuranceNumberIndex: null,
    });
  });

  it('names what another type needs, and writes nothing', async () => {
    const context = setUp();
    const failure: unknown = await context
      .inPractice(() => context.service.update(ACTOR, SELF, { insuranceType: 'PRIVATE' }, 'x'))
      .catch((error: unknown) => error);
    expect(problemsOf(failure)).toEqual([
      { field: 'insuranceProvider', code: 'REQUIRED' },
      { field: 'insuranceNumber', code: 'REQUIRED' },
    ]);
    expect(context.practice.patient.update).not.toHaveBeenCalled();
  });

  it('refuses a birth date that is none', async () => {
    const context = setUp();
    const failure: unknown = await context
      .inPractice(() => context.service.update(ACTOR, SELF, { dateOfBirth: '2026-02-31' }, 'x'))
      .catch((error: unknown) => error);
    expect(problemsOf(failure)).toEqual([{ field: 'dateOfBirth', code: 'INVALID_VALUE' }]);
  });

  it('answers 404 for anyone else, and when the row is gone', async () => {
    const context = setUp();
    await expect(
      context.inPractice(() => context.service.update(ACTOR, 'another', {}, 'x')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    context.practice.patient.findUnique.mockResolvedValue(null);
    await expect(
      context.inPractice(() => context.service.update(ACTOR, SELF, {}, 'x')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

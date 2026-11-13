import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { ClsServiceManager } from 'nestjs-cls';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../common/context/request-context.js';
import type { PlatformPrismaService } from '../../common/database/platform-prisma.service.js';
import type { PlatformTransactionHost } from '../../common/database/platform-transactional.js';
import type { PlatformAudit } from '../../common/security/platform-audit.js';
import type { IntegrationRelay } from '../../common/tenancy/integration-relay.js';
import type { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { FixedClock } from '../../common/time/fixed-clock.js';
import type { AccountNotifications } from '../notifications/account-notifications.js';
import { TEAM_AUDIT, Team } from './team.service.js';

const cls = ClsServiceManager.getClsService<RequestContext>();
const NOW = Temporal.Instant.from('2026-11-13T09:00:00Z');

const MANAGER = '00000000-0000-4000-8000-000000000001';
const DOCTOR = '00000000-0000-4000-8000-000000000002';
const RECEPTION = '00000000-0000-4000-8000-000000000003';
const GONE = '00000000-0000-4000-8000-000000000004';
const LINA = '70000000-0000-4000-8000-000000000001';
const OMAR = '70000000-0000-4000-8000-000000000002';
const UNKNOWN = '00000000-0000-4000-8000-0000000000ff';

const ACTOR = { userId: `user-${MANAGER}`, sessionId: 's', amr: ['pwd', 'otp'] };

interface Row {
  readonly id: string;
  readonly userId: string;
  role: 'STAFF' | 'DOCTOR';
  managesPractice: boolean;
  status: 'ACTIVE' | 'DISABLED';
  staffMemberId: string | null;
}

function rowOf(id: string, place: Partial<Row> = {}): Row {
  return {
    id,
    userId: `user-${id}`,
    role: 'STAFF',
    managesPractice: false,
    status: 'ACTIVE',
    staffMemberId: null,
    ...place,
  };
}

function setUp({
  confirmed = true,
  secondFactor = true,
}: { readonly confirmed?: boolean; readonly secondFactor?: boolean } = {}) {
  /** Accounts deleted meanwhile: their memberships wait for PR01. */
  const gone = new Set<string>();
  const rows: Row[] = [
    rowOf(MANAGER, { managesPractice: true }),
    rowOf(DOCTOR, { role: 'DOCTOR', staffMemberId: LINA }),
    rowOf(RECEPTION),
    rowOf(GONE, { status: 'DISABLED' }),
  ];
  const byId = (id: string): Row | undefined => rows.find((row) => row.id === id);
  const practiceDb = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    membership: {
      findMany: vi.fn(() => Promise.resolve(rows.map((row) => ({ ...row })))),
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        const row = byId(where.id);
        return Promise.resolve(row === undefined ? null : { ...row });
      }),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = byId(where.id);
        if (row !== undefined) Object.assign(row, data);
        return Promise.resolve(row);
      }),
      count: vi.fn(() =>
        Promise.resolve(
          rows.filter((row) => row.managesPractice && row.status === 'ACTIVE').length,
        ),
      ),
    },
    staffMember: {
      findMany: vi.fn(() =>
        Promise.resolve(
          [
            { id: LINA, title: 'Dr.', firstName: 'Lina', lastName: 'Example' },
            { id: OMAR, title: null, firstName: 'Omar', lastName: 'Example' },
          ].map((doctor) => {
            const linked = rows.find((row) => row.staffMemberId === doctor.id);
            return { ...doctor, membership: linked === undefined ? null : { id: linked.id } };
          }),
        ),
      ),
      findFirst: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === LINA || where.id === OMAR ? { id: where.id } : null),
      ),
    },
  };
  const platformDb = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    user: {
      findUnique: vi.fn(() =>
        Promise.resolve({
          emailVerifiedAt: confirmed ? new Date('2026-11-01T00:00:00Z') : null,
          totpEnabledAt: secondFactor ? new Date('2026-11-02T00:00:00Z') : null,
          totpSecretEncrypted: secondFactor ? 'sealed' : null,
        }),
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    mfaRecoveryCode: { deleteMany: vi.fn().mockResolvedValue({ count: 10 }) },
    session: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
  const platform = {
    user: {
      findMany: vi.fn(() =>
        Promise.resolve(
          rows
            .filter((row) => !gone.has(row.userId))
            .map((row) => ({
              id: row.userId,
              email: `${row.id.slice(-4)}@example.test`,
              totpEnabledAt: row.id === RECEPTION ? null : new Date('2026-11-02T00:00:00Z'),
              profile:
                row.id === RECEPTION
                  ? null
                  : { firstName: 'Synthetic', lastName: row.id.slice(-1) },
            })),
        ),
      ),
    },
  };
  const relay = {
    recordAccessChange: vi.fn().mockResolvedValue(7n),
    applyNow: vi.fn().mockResolvedValue(undefined),
  };
  const audit = {
    record: vi
      .fn<(entry: { readonly action: string }) => Promise<void>>()
      .mockResolvedValue(undefined),
    ipHashOf: vi.fn().mockResolvedValue('ip-hash'),
  };
  const platformAudit = { record: vi.fn().mockResolvedValue(undefined) };
  const notifications = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const logger = { setContext: vi.fn(), error: vi.fn() };
  const practiceTx = {
    tx: practiceDb,
    withTransaction: <T>(work: () => Promise<T>): Promise<T> => work(),
  } as unknown as PracticeTransactionHost;
  const platformWork = vi.fn(<T>(work: () => Promise<T>): Promise<T> => work());
  const platformTx = {
    tx: platformDb,
    withTransaction: platformWork,
  } as unknown as PlatformTransactionHost;
  const team = new Team(
    practiceTx,
    platformTx,
    platform as unknown as PlatformPrismaService,
    relay as unknown as IntegrationRelay,
    audit as unknown as PracticeAudit,
    platformAudit as unknown as PlatformAudit,
    notifications as unknown as AccountNotifications,
    new FixedClock(NOW),
    cls,
    logger as unknown as PinoLogger,
  );
  const inPractice = <T>(work: () => Promise<T>) =>
    cls.run(() => {
      cls.set('practice', {
        practice: { id: 'practice-a', market: 'SA', routeVersion: 1, schemaVersion: 'v' },
        lease: {} as never,
        staff: { membershipId: MANAGER, role: 'STAFF', managesPractice: true, providerId: null },
      });
      return work();
    });
  const actions = (): string[] => audit.record.mock.calls.map(([entry]) => entry.action);
  return {
    team,
    gone,
    rows,
    practiceDb,
    platformDb,
    relay,
    audit,
    platformAudit,
    notifications,
    logger,
    platformWork,
    inPractice,
    actions,
  };
}

describe('Team.list', () => {
  it('names each member with its account, place, doctor and second factor, and the asker', async () => {
    const { team } = setUp();
    const list = await team.list(ACTOR);
    expect(list.doctors).toEqual([
      { id: LINA, name: 'Dr. Lina Example', membershipId: DOCTOR },
      { id: OMAR, name: 'Omar Example', membershipId: null },
    ]);
    expect(list.members).toHaveLength(4);
    expect(list.members[0]).toMatchObject({ id: MANAGER, managesPractice: true, you: true });
    expect(list.members[1]).toMatchObject({
      id: DOCTOR,
      role: 'DOCTOR',
      doctor: { id: LINA, name: 'Dr. Lina Example' },
      you: false,
    });
    // An account without a profile has no name yet, and this one no authenticator app.
    expect(list.members[2]).toMatchObject({ id: RECEPTION, name: null, secondFactor: false });
    expect(list.members[3]).toMatchObject({ id: GONE, active: false });
  });

  it('leaves out a membership whose account is gone', async () => {
    const { team, rows, gone } = setUp();
    rows.push(rowOf(UNKNOWN));
    gone.add(`user-${UNKNOWN}`);
    const ids = (await team.list(ACTOR)).members.map(({ id }) => id);
    expect(ids).toEqual([MANAGER, DOCTOR, RECEPTION, GONE]);
  });
});

describe('Team.changeRole', () => {
  it('refuses an id that is no UUID, and a doctor for the practice team', async () => {
    const { team, inPractice } = setUp();
    await expect(
      inPractice(() =>
        team.changeRole(ACTOR, 'not-a-uuid', { role: 'STAFF', managesPractice: false }, undefined),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      inPractice(() =>
        team.changeRole(
          ACTOR,
          RECEPTION,
          { role: 'STAFF', managesPractice: false, providerId: OMAR },
          undefined,
        ),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('answers NOT_FOUND for an unknown member and CONFLICT for a deactivated one', async () => {
    const { team, inPractice } = setUp();
    await expect(
      inPractice(() =>
        team.changeRole(ACTOR, UNKNOWN, { role: 'STAFF', managesPractice: false }, undefined),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      inPractice(() =>
        team.changeRole(ACTOR, GONE, { role: 'STAFF', managesPractice: true }, undefined),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('keeps the last person with practice management', async () => {
    const { team, inPractice, practiceDb } = setUp();
    await expect(
      inPractice(() =>
        team.changeRole(ACTOR, MANAGER, { role: 'STAFF', managesPractice: false }, undefined),
      ),
    ).rejects.toMatchObject({ code: 'LAST_PRACTICE_MANAGER' });
    // The member and every active manager were locked first, in one order.
    expect(practiceDb.$queryRaw).toHaveBeenCalled();
    expect(practiceDb.membership.update).not.toHaveBeenCalled();
  });

  it('makes the practice team a doctor with practice management, audited and told', async () => {
    const { team, inPractice, rows, actions, notifications } = setUp();
    const saved = await inPractice(() =>
      team.changeRole(
        ACTOR,
        RECEPTION,
        { role: 'DOCTOR', managesPractice: true, providerId: OMAR },
        '203.0.113.9',
      ),
    );
    expect(rows.find(({ id }) => id === RECEPTION)).toMatchObject({
      role: 'DOCTOR',
      managesPractice: true,
      staffMemberId: OMAR,
    });
    expect(actions()).toEqual([TEAM_AUDIT.role, TEAM_AUDIT.grant, TEAM_AUDIT.link]);
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ userId: `user-${RECEPTION}`, template: 'TEAM_ROLE_CHANGED' }),
    );
    expect(saved).toMatchObject({ id: RECEPTION, role: 'DOCTOR', doctor: { id: OMAR } });
  });

  it('takes a doctor’s link and management away, and keeps a link that is left out', async () => {
    const { team, inPractice, rows, actions } = setUp();
    rows[1] = rowOf(DOCTOR, { role: 'DOCTOR', staffMemberId: LINA, managesPractice: true });
    await inPractice(() =>
      team.changeRole(ACTOR, DOCTOR, { role: 'DOCTOR', managesPractice: true }, undefined),
    );
    // Nothing changed: no update, no audit row, no e-mail.
    expect(actions()).toEqual([]);
    await inPractice(() =>
      team.changeRole(ACTOR, DOCTOR, { role: 'STAFF', managesPractice: false }, undefined),
    );
    expect(rows[1]).toMatchObject({ role: 'STAFF', managesPractice: false, staffMemberId: null });
    expect(actions()).toEqual([TEAM_AUDIT.role, TEAM_AUDIT.revoke, TEAM_AUDIT.unlink]);
  });

  it('refuses a doctor the practice does not have', async () => {
    const { team, inPractice } = setUp();
    await expect(
      inPractice(() =>
        team.changeRole(
          ACTOR,
          RECEPTION,
          { role: 'DOCTOR', managesPractice: false, providerId: UNKNOWN },
          undefined,
        ),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('answers DOCTOR_ALREADY_LINKED when another account is the doctor', async () => {
    const { team, inPractice, practiceDb } = setUp();
    practiceDb.membership.update.mockRejectedValueOnce(
      new PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '7' }),
    );
    await expect(
      inPractice(() =>
        team.changeRole(
          ACTOR,
          RECEPTION,
          { role: 'DOCTOR', managesPractice: false, providerId: LINA },
          undefined,
        ),
      ),
    ).rejects.toMatchObject({ code: 'DOCTOR_ALREADY_LINKED' });
    practiceDb.membership.update.mockRejectedValueOnce(new Error('connection lost'));
    await expect(
      inPractice(() =>
        team.changeRole(
          ACTOR,
          RECEPTION,
          { role: 'DOCTOR', managesPractice: false, providerId: OMAR },
          undefined,
        ),
      ),
    ).rejects.toThrow('connection lost');
  });

  it('tells nobody of one’s own change, and keeps a change whose e-mail failed', async () => {
    const { team, inPractice, rows, notifications, logger } = setUp();
    rows.push(rowOf(UNKNOWN, { managesPractice: true }));
    await inPractice(() =>
      team.changeRole(ACTOR, MANAGER, { role: 'DOCTOR', managesPractice: false }, undefined),
    );
    expect(notifications.enqueue).not.toHaveBeenCalled();
    notifications.enqueue.mockRejectedValueOnce(new Error('platform down'));
    await inPractice(() =>
      team.changeRole(ACTOR, RECEPTION, { role: 'STAFF', managesPractice: true }, undefined),
    );
    expect(rows.find(({ id }) => id === RECEPTION)?.managesPractice).toBe(true);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('sends no e-mail to an address nobody confirmed', async () => {
    const { team, inPractice, notifications } = setUp({ confirmed: false });
    await inPractice(() =>
      team.changeRole(ACTOR, RECEPTION, { role: 'STAFF', managesPractice: true }, undefined),
    );
    expect(notifications.enqueue).not.toHaveBeenCalled();
  });
});

describe('Team.deactivate', () => {
  it('refuses an id that is no UUID and one’s own account', async () => {
    const { team, inPractice } = setUp();
    await expect(inPractice(() => team.deactivate(ACTOR, 'x', undefined))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      inPractice(() => team.deactivate(ACTOR, MANAGER, undefined)),
    ).rejects.toMatchObject({ code: 'NOT_ON_YOURSELF' });
  });

  it('ends the access, the doctor’s link and every session, audited and told (E14)', async () => {
    const { team, inPractice, rows, actions, relay, platformDb, platformAudit, notifications } =
      setUp();
    const saved = await inPractice(() => team.deactivate(ACTOR, DOCTOR, '203.0.113.9'));
    expect(rows[1]).toMatchObject({ status: 'DISABLED', staffMemberId: null });
    expect(actions()).toEqual([TEAM_AUDIT.deactivate, TEAM_AUDIT.unlink]);
    expect(relay.recordAccessChange).toHaveBeenCalledWith({
      userId: `user-${DOCTOR}`,
      capacity: 'STAFF',
      active: false,
    });
    expect(relay.applyNow).toHaveBeenCalledWith('practice-a', 7n, expect.anything());
    expect(platformDb.session.updateMany).toHaveBeenCalledWith({
      where: { userId: `user-${DOCTOR}`, revokedAt: null },
      data: { revokedAt: new Date('2026-11-13T09:00:00Z') },
    });
    // The users row first: a refresh under way holds it, and its new session ends too.
    const [locked] = platformDb.$queryRaw.mock.invocationCallOrder;
    const [ended] = platformDb.session.updateMany.mock.invocationCallOrder;
    expect(locked).toBeLessThan(ended ?? 0);
    expect(platformAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.sessions.revoke-by-practice' }),
    );
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'TEAM_ACCESS_ENDED' }),
    );
    expect(saved).toMatchObject({ id: DOCTOR, active: false, doctor: null });
  });

  it('does nothing more for a member already deactivated', async () => {
    const { team, inPractice, relay, actions } = setUp();
    await inPractice(() => team.deactivate(ACTOR, GONE, undefined));
    expect(actions()).toEqual([]);
    expect(relay.applyNow).not.toHaveBeenCalled();
  });

  it('keeps the last manager, and answers the failure when the sessions could not end', async () => {
    const { team, inPractice, rows, platformDb, logger, notifications } = setUp();
    rows.push(rowOf(UNKNOWN, { managesPractice: true }));
    // Of two managers one may go; then the other is the last one.
    await expect(
      inPractice(() => team.deactivate(ACTOR, UNKNOWN, undefined)),
    ).resolves.toMatchObject({ active: false });
    await expect(
      inPractice(() => team.deactivate({ ...ACTOR, userId: 'user-other' }, MANAGER, undefined)),
    ).rejects.toMatchObject({ code: 'LAST_PRACTICE_MANAGER' });
    notifications.enqueue.mockClear();
    platformDb.session.updateMany.mockRejectedValueOnce(new Error('platform down'));
    await expect(inPractice(() => team.deactivate(ACTOR, RECEPTION, undefined))).rejects.toThrow(
      'platform down',
    );
    // The access has ended all the same; nobody is told that the sessions did.
    expect(rows[2]?.status).toBe('DISABLED');
    expect(notifications.enqueue).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe('Team.reactivate', () => {
  it('ends every session first, then gives the access back, audited and told (E13)', async () => {
    const { team, inPractice, rows, actions, relay, notifications, practiceDb, platformDb } =
      setUp();
    const saved = await inPractice(() => team.reactivate(ACTOR, GONE, undefined));
    expect(rows[3]?.status).toBe('ACTIVE');
    // A session from before the deactivation does not come back with the access.
    expect(platformDb.session.updateMany).toHaveBeenCalledWith({
      where: { userId: `user-${GONE}`, revokedAt: null },
      data: { revokedAt: new Date('2026-11-13T09:00:00Z') },
    });
    const [locked] = platformDb.$queryRaw.mock.invocationCallOrder;
    const [ended] = platformDb.session.updateMany.mock.invocationCallOrder;
    const [back] = practiceDb.membership.update.mock.invocationCallOrder;
    expect(locked).toBeLessThan(ended ?? 0);
    expect(ended).toBeLessThan(back ?? 0);
    expect(actions()).toEqual([TEAM_AUDIT.reactivate]);
    expect(relay.recordAccessChange).toHaveBeenCalledWith(
      expect.objectContaining({ active: true }),
    );
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'TEAM_ROLE_CHANGED' }),
    );
    expect(saved).toMatchObject({ id: GONE, active: true });
  });

  it('does nothing for an active member, and refuses an unknown one', async () => {
    const { team, inPractice, actions, platformDb } = setUp();
    await inPractice(() => team.reactivate(ACTOR, RECEPTION, undefined));
    expect(actions()).toEqual([]);
    expect(platformDb.session.updateMany).not.toHaveBeenCalled();
    for (const id of ['x', UNKNOWN]) {
      await expect(inPractice(() => team.reactivate(ACTOR, id, undefined))).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
  });

  it('gives nothing back when the sessions could not end', async () => {
    const { team, inPractice, rows, actions, platformDb } = setUp();
    platformDb.session.updateMany.mockRejectedValueOnce(new Error('platform down'));
    await expect(inPractice(() => team.reactivate(ACTOR, GONE, undefined))).rejects.toThrow(
      'platform down',
    );
    expect(rows[3]?.status).toBe('DISABLED');
    expect(actions()).toEqual([]);
  });
});

describe('Team.resetSecondFactor', () => {
  it('refuses an unknown member, one’s own account and a deactivated member', async () => {
    const { team, inPractice } = setUp();
    await expect(
      inPractice(() => team.resetSecondFactor(ACTOR, 'x', undefined)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      inPractice(() => team.resetSecondFactor(ACTOR, UNKNOWN, undefined)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      inPractice(() => team.resetSecondFactor(ACTOR, MANAGER, undefined)),
    ).rejects.toMatchObject({ code: 'NOT_ON_YOURSELF' });
    await expect(
      inPractice(() => team.resetSecondFactor(ACTOR, GONE, undefined)),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('removes the app and the recovery codes, ends the sessions, audits in both logs (E15)', async () => {
    const { team, inPractice, platformDb, platformAudit, notifications, actions } = setUp();
    await inPractice(() => team.resetSecondFactor(ACTOR, DOCTOR, '203.0.113.9'));
    expect(platformDb.$queryRaw).toHaveBeenCalled();
    expect(platformDb.user.update).toHaveBeenCalledWith({
      where: { id: `user-${DOCTOR}` },
      data: { totpSecretEncrypted: null, totpEnabledAt: null, totpLastStep: null },
    });
    expect(platformDb.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({
      where: { userId: `user-${DOCTOR}` },
    });
    expect(platformDb.session.updateMany).toHaveBeenCalled();
    expect(platformAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.second-factor.reset-by-practice' }),
    );
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'TEAM_SECOND_FACTOR_RESET' }),
    );
    expect(actions()).toEqual([TEAM_AUDIT.secondFactorReset]);
  });

  it('changes nothing for an account without an app, and tells no unconfirmed address', async () => {
    const without = setUp({ secondFactor: false });
    await without.inPractice(() => without.team.resetSecondFactor(ACTOR, DOCTOR, undefined));
    expect(without.platformDb.user.update).not.toHaveBeenCalled();
    expect(without.actions()).toEqual([]);
    const unconfirmed = setUp({ confirmed: false });
    await unconfirmed.inPractice(() =>
      unconfirmed.team.resetSecondFactor(ACTOR, DOCTOR, undefined),
    );
    expect(unconfirmed.notifications.enqueue).not.toHaveBeenCalled();
    expect(unconfirmed.actions()).toEqual([TEAM_AUDIT.secondFactorReset]);
  });

  it('answers NOT_FOUND when the account is gone', async () => {
    const { team, inPractice, platformDb } = setUp();
    platformDb.user.findUnique.mockResolvedValueOnce(null as never);
    await expect(
      inPractice(() => team.resetSecondFactor(ACTOR, DOCTOR, undefined)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

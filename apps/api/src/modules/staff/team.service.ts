import { randomUUID } from 'node:crypto';
import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PinoLogger } from 'nestjs-pino';
import type { RequestContext } from '../../common/context/request-context.js';
import { isUuid } from '../../common/context/request-id.js';
import { PlatformPrismaService } from '../../common/database/platform-prisma.service.js';
import type { PlatformTransactionHost } from '../../common/database/platform-transactional.js';
import { isPrismaKnownRequestError } from '../../common/database/prisma-errors.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { FIELD_ERROR_MESSAGES } from '../../common/errors/field-error-codes.js';
import type { Actor } from '../../common/security/actor.js';
import { auditActorOf, PlatformAudit } from '../../common/security/platform-audit.js';
import { IntegrationRelay } from '../../common/tenancy/integration-relay.js';
import type { AccessChange } from '../../common/tenancy/practice-access-index.js';
import { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import { requirePracticeContext } from '../../common/tenancy/practice-context.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf } from '../../common/time/convert.js';
import type { AccountNotificationTemplate } from '../../generated/platform/enums.js';
import type { MembershipStatus, StaffRole } from '../../generated/practice/enums.js';
import { AccountNotifications } from '../notifications/account-notifications.js';
import type { ChangeTeamRoleDto, TeamDoctorDto, TeamDto, TeamMemberDto } from './team.dto.js';

/** The audit actions of the team page (W15, D17): constants, each with its subject. */
export const TEAM_AUDIT = {
  /** The membership. */
  role: 'staff.role.set',
  grant: 'staff.management.grant',
  revoke: 'staff.management.revoke',
  deactivate: 'staff.deactivate',
  reactivate: 'staff.reactivate',
  secondFactorReset: 'staff.second-factor.reset',
  /** The doctor. */
  link: 'staff.provider.link',
  unlink: 'staff.provider.unlink',
} as const;

/** In the platform's log, where the actor is the only person it names. */
const PLATFORM_AUDIT = {
  sessionsEnded: 'auth.sessions.revoke-by-practice',
  secondFactorReset: 'auth.second-factor.reset-by-practice',
} as const;

interface Member {
  readonly id: string;
  readonly userId: string;
  readonly role: StaffRole;
  readonly managesPractice: boolean;
  readonly status: MembershipStatus;
  readonly staffMemberId: string | null;
}

const MEMBER = {
  id: true,
  userId: true,
  role: true,
  managesPractice: true,
  status: true,
  staffMemberId: true,
} as const;

interface DoctorName {
  readonly title: string | null;
  readonly firstName: string;
  readonly lastName: string;
}

function nameOf({ title, firstName, lastName }: DoctorName): string {
  return [title, firstName, lastName].filter((part) => part !== null && part !== '').join(' ');
}

function providerProblem(): DomainException {
  return new DomainException('VALIDATION_FAILED', {
    fieldErrors: [
      { field: 'providerId', code: 'INVALID_VALUE', message: FIELD_ERROR_MESSAGES.INVALID_VALUE },
    ],
  });
}

/** A change of access the index follows: written in the practice's transaction (ADR 0005 §1.4). */
interface AccessEvent {
  readonly userId: string;
  readonly version: bigint;
  readonly change: AccessChange;
}

/**
 * The team of the practice (W15, D17), for practice management: who is in it, with which base role,
 * practice management and doctor, and the changes of it. Only practice management changes roles,
 * management too; the last person with it keeps it and stays active. Each change is audited in the
 * practice's log, and the person is told by e-mail, without a link and without the role (E13 to
 * E15). What ends access or the authenticator app also ends every session of the account.
 */
@Injectable()
export class Team {
  constructor(
    @InjectTransactionHost('practice') private readonly practiceTx: PracticeTransactionHost,
    @InjectTransactionHost('platform') private readonly platformTx: PlatformTransactionHost,
    private readonly platform: PlatformPrismaService,
    private readonly relay: IntegrationRelay,
    private readonly audit: PracticeAudit,
    private readonly platformAudit: PlatformAudit,
    private readonly notifications: AccountNotifications,
    private readonly clock: Clock,
    private readonly cls: ClsService<RequestContext>,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(Team.name);
  }

  async list(actor: Actor): Promise<TeamDto> {
    const db = this.practiceTx.tx;
    const members = await db.membership.findMany({
      select: MEMBER,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const doctors = await db.staffMember.findMany({
      where: { isProvider: true },
      select: {
        id: true,
        title: true,
        firstName: true,
        lastName: true,
        membership: { select: { id: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
    });
    const doctorDtos: TeamDoctorDto[] = doctors.map((doctor) => ({
      id: doctor.id,
      name: nameOf(doctor),
      membershipId: doctor.membership?.id ?? null,
    }));
    const accounts = await this.platform.user.findMany({
      where: { id: { in: members.map(({ userId }) => userId) } },
      select: {
        id: true,
        email: true,
        totpEnabledAt: true,
        profile: { select: { firstName: true, lastName: true } },
      },
    });
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const doctorById = new Map(doctorDtos.map((doctor) => [doctor.id, doctor]));
    const dtos: TeamMemberDto[] = [];
    for (const member of members) {
      const account = accountById.get(member.userId);
      // An account deleted meanwhile: its membership waits for PR01, and shows nobody.
      if (account === undefined) continue;
      dtos.push({
        id: member.id,
        name:
          account.profile === null
            ? null
            : `${account.profile.firstName} ${account.profile.lastName}`.trim(),
        email: account.email,
        role: member.role,
        managesPractice: member.managesPractice,
        active: member.status === 'ACTIVE',
        secondFactor: account.totpEnabledAt !== null,
        doctor:
          member.staffMemberId === null ? null : (doctorById.get(member.staffMemberId) ?? null),
        you: member.userId === actor.userId,
      });
    }
    return { members: dtos, doctors: doctorDtos };
  }

  /** A base role, practice management and the doctor, as practice management says (D17). */
  async changeRole(
    actor: Actor,
    membershipId: string,
    input: ChangeTeamRoleDto,
    ip: string | undefined,
  ): Promise<TeamMemberDto> {
    const { practice } = requirePracticeContext(this.cls);
    if (!isUuid(membershipId)) throw new DomainException('NOT_FOUND');
    // Only a doctor's account names the doctor it is (M04).
    if (input.role !== 'DOCTOR' && typeof input.providerId === 'string') throw providerProblem();
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    let changed: Member | undefined;
    try {
      changed = await this.practiceTx.withTransaction(async () => {
        const member = await this.lockedMember(membershipId);
        // A deactivated member comes back first, with its place as it was.
        if (member.status !== 'ACTIVE') throw new DomainException('CONFLICT');
        if (member.managesPractice && !input.managesPractice) await this.keepAManager();
        const link =
          input.role !== 'DOCTOR'
            ? null
            : input.providerId === undefined
              ? member.staffMemberId
              : input.providerId;
        if (link !== null && link !== member.staffMemberId) await this.requireDoctor(link);
        const same =
          member.role === input.role &&
          member.managesPractice === input.managesPractice &&
          member.staffMemberId === link;
        if (same) return undefined;
        await this.practiceTx.tx.membership.update({
          where: { id: member.id },
          data: { role: input.role, managesPractice: input.managesPractice, staffMemberId: link },
        });
        const record = (action: string, subjectId: string): Promise<void> =>
          this.audit.record({ userId: actor.userId, action, subjectId, ipHash });
        if (member.role !== input.role) await record(TEAM_AUDIT.role, member.id);
        if (member.managesPractice !== input.managesPractice) {
          await record(input.managesPractice ? TEAM_AUDIT.grant : TEAM_AUDIT.revoke, member.id);
        }
        if (member.staffMemberId !== link) {
          if (member.staffMemberId !== null) await record(TEAM_AUDIT.unlink, member.staffMemberId);
          if (link !== null) await record(TEAM_AUDIT.link, link);
        }
        return member;
      });
    } catch (error) {
      // Another account is this doctor already: one doctor, one account (M04).
      if (isPrismaKnownRequestError(error) && error.code === 'P2002') {
        throw new DomainException('DOCTOR_ALREADY_LINKED');
      }
      throw error;
    }
    if (changed !== undefined && changed.userId !== actor.userId) {
      await this.tell(changed.userId, 'TEAM_ROLE_CHANGED');
    }
    return this.memberOf(actor, membershipId);
  }

  /**
   * Ends a member's access, on its next request: the membership is DISABLED, the doctor's link
   * goes, the index follows, and every session of the account ends (D17). Not one's own. When the
   * sessions cannot end, the access has ended all the same, and the answer is the failure.
   */
  async deactivate(
    actor: Actor,
    membershipId: string,
    ip: string | undefined,
  ): Promise<TeamMemberDto> {
    const { practice } = requirePracticeContext(this.cls);
    if (!isUuid(membershipId)) throw new DomainException('NOT_FOUND');
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    const event = await this.practiceTx.withTransaction(
      async (): Promise<AccessEvent | undefined> => {
        const member = await this.lockedMember(membershipId);
        if (member.userId === actor.userId) throw new DomainException('NOT_ON_YOURSELF');
        if (member.status !== 'ACTIVE') return undefined;
        if (member.managesPractice) await this.keepAManager();
        await this.practiceTx.tx.membership.update({
          where: { id: member.id },
          data: { status: 'DISABLED', staffMemberId: null },
        });
        await this.audit.record({
          userId: actor.userId,
          action: TEAM_AUDIT.deactivate,
          subjectId: member.id,
          ipHash,
        });
        if (member.staffMemberId !== null) {
          await this.audit.record({
            userId: actor.userId,
            action: TEAM_AUDIT.unlink,
            subjectId: member.staffMemberId,
            ipHash,
          });
        }
        const change: AccessChange = { userId: member.userId, capacity: 'STAFF', active: false };
        return {
          userId: member.userId,
          version: await this.relay.recordAccessChange(change),
          change,
        };
      },
    );
    if (event !== undefined) {
      await this.relay.applyNow(practice.id, event.version, event.change);
      await this.endSessions(actor, event.userId);
    }
    return this.memberOf(actor, membershipId);
  }

  /**
   * Gives a deactivated member its access back, with its role and management as they were. Every
   * session of the account ends first: one that a failure or a refresh at the moment of the
   * deactivation left must not come back with the access (security review of M03). The person
   * signs in again; when the sessions cannot end, nothing comes back.
   */
  async reactivate(
    actor: Actor,
    membershipId: string,
    ip: string | undefined,
  ): Promise<TeamMemberDto> {
    const { practice } = requirePracticeContext(this.cls);
    if (!isUuid(membershipId)) throw new DomainException('NOT_FOUND');
    const before = await this.practiceTx.tx.membership.findUnique({
      where: { id: membershipId },
      select: MEMBER,
    });
    if (before === null) throw new DomainException('NOT_FOUND');
    if (before.status === 'ACTIVE') return this.memberOf(actor, membershipId);
    await this.platformTx.withTransaction(() => this.revokeSessionsOf(actor, before.userId));
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    const event = await this.practiceTx.withTransaction(
      async (): Promise<AccessEvent | undefined> => {
        const member = await this.lockedMember(membershipId);
        if (member.status === 'ACTIVE') return undefined;
        await this.practiceTx.tx.membership.update({
          where: { id: member.id },
          data: { status: 'ACTIVE' },
        });
        await this.audit.record({
          userId: actor.userId,
          action: TEAM_AUDIT.reactivate,
          subjectId: member.id,
          ipHash,
        });
        const change: AccessChange = { userId: member.userId, capacity: 'STAFF', active: true };
        return {
          userId: member.userId,
          version: await this.relay.recordAccessChange(change),
          change,
        };
      },
    );
    if (event !== undefined) {
      await this.relay.applyNow(practice.id, event.version, event.change);
      await this.tell(event.userId, 'TEAM_ROLE_CHANGED');
    }
    return this.memberOf(actor, membershipId);
  }

  /**
   * A lost authenticator app (RT-96): the account's app and recovery codes go, and every session
   * with them; at the next sign-in the person sets up a new app. In one platform transaction with
   * its audit row and the e-mail (E15). Not one's own: the account page has its recovery codes.
   */
  async resetSecondFactor(
    actor: Actor,
    membershipId: string,
    ip: string | undefined,
  ): Promise<TeamMemberDto> {
    const { practice } = requirePracticeContext(this.cls);
    if (!isUuid(membershipId)) throw new DomainException('NOT_FOUND');
    const member = await this.practiceTx.tx.membership.findUnique({
      where: { id: membershipId },
      select: MEMBER,
    });
    if (member === null) throw new DomainException('NOT_FOUND');
    if (member.userId === actor.userId) throw new DomainException('NOT_ON_YOURSELF');
    if (member.status !== 'ACTIVE') throw new DomainException('CONFLICT');
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    const now = dbInstantOf(this.clock.now());
    const reset = await this.platformTx.withTransaction(async () => {
      const db = this.platformTx.tx;
      await db.$queryRaw`SELECT 1 FROM users WHERE id = ${member.userId}::uuid FOR UPDATE`;
      const user = await db.user.findUnique({
        where: { id: member.userId },
        select: { totpEnabledAt: true, totpSecretEncrypted: true, emailVerifiedAt: true },
      });
      if (user === null) throw new DomainException('NOT_FOUND');
      // Nothing set up: nothing to take away, and nothing to tell.
      if (user.totpEnabledAt === null && user.totpSecretEncrypted === null) return false;
      await db.user.update({
        where: { id: member.userId },
        data: { totpSecretEncrypted: null, totpEnabledAt: null, totpLastStep: null },
      });
      await db.mfaRecoveryCode.deleteMany({ where: { userId: member.userId } });
      await db.session.updateMany({
        where: { userId: member.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.platformAudit.record({
        actor: auditActorOf(actor.userId),
        action: PLATFORM_AUDIT.secondFactorReset,
        outcome: 'SUCCEEDED',
      });
      if (user.emailVerifiedAt !== null) {
        await this.notifications.enqueue({
          userId: member.userId,
          template: 'TEAM_SECOND_FACTOR_RESET',
          dedupeKey: `team-notice:${randomUUID()}`,
        });
      }
      return true;
    });
    if (reset) {
      await this.practiceTx.withTransaction(() =>
        this.audit.record({
          userId: actor.userId,
          action: TEAM_AUDIT.secondFactorReset,
          subjectId: member.id,
          ipHash,
        }),
      );
    }
    return this.memberOf(actor, membershipId);
  }

  /**
   * The member, and every active manager, locked in one order: two changes at once count each
   * other, and the last manager cannot leave through a gap between them (D17).
   */
  private async lockedMember(membershipId: string): Promise<Member> {
    const db = this.practiceTx.tx;
    await db.$queryRaw`SELECT id FROM memberships
      WHERE id = ${membershipId}::uuid OR (manages_practice AND status = 'ACTIVE')
      ORDER BY id FOR UPDATE`;
    const member = await db.membership.findUnique({ where: { id: membershipId }, select: MEMBER });
    if (member === null) throw new DomainException('NOT_FOUND');
    return member;
  }

  /** Under the lock of lockedMember: some other active member keeps practice management. */
  private async keepAManager(): Promise<void> {
    const managers = await this.practiceTx.tx.membership.count({
      where: { managesPractice: true, status: 'ACTIVE' },
    });
    if (managers <= 1) throw new DomainException('LAST_PRACTICE_MANAGER');
  }

  private async requireDoctor(providerId: string): Promise<void> {
    const doctor = await this.practiceTx.tx.staffMember.findFirst({
      where: { id: providerId, isProvider: true },
      select: { id: true },
    });
    if (doctor === null) throw providerProblem();
  }

  private async memberOf(actor: Actor, membershipId: string): Promise<TeamMemberDto> {
    const member = (await this.list(actor)).members.find(({ id }) => id === membershipId);
    if (member === undefined) throw new DomainException('NOT_FOUND');
    return member;
  }

  /**
   * After the practice's change has committed, which already ends the team's pages for the person:
   * every session of the account ends too, and the person is told (E14). A failure here leaves the
   * change in force, is logged, and is the answer: the page does not say the sessions ended, and a
   * session that lives on ends at the latest when the access comes back (reactivate).
   */
  private async endSessions(actor: Actor, userId: string): Promise<void> {
    try {
      await this.platformTx.withTransaction(async () => {
        await this.revokeSessionsOf(actor, userId);
        await this.enqueueIfConfirmed(userId, 'TEAM_ACCESS_ENDED');
      });
    } catch (error) {
      this.logger.error({ err: error }, 'team access ended, its sessions and e-mail did not');
      throw error;
    }
  }

  /**
   * Inside a platform transaction: every session of the account ends, audited. The users row's lock
   * comes first, as for a sign-out (auth.service.ts): a refresh holds it while it makes a session,
   * and an update without it would miss that session, which would live on.
   */
  private async revokeSessionsOf(actor: Actor, userId: string): Promise<void> {
    const db = this.platformTx.tx;
    await db.$queryRaw`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    await db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: dbInstantOf(this.clock.now()) },
    });
    await this.platformAudit.record({
      actor: auditActorOf(actor.userId),
      action: PLATFORM_AUDIT.sessionsEnded,
      outcome: 'SUCCEEDED',
    });
  }

  /** E13, after the change has committed; a failure leaves the change in force, and is logged. */
  private async tell(userId: string, template: AccountNotificationTemplate): Promise<void> {
    try {
      await this.platformTx.withTransaction(() => this.enqueueIfConfirmed(userId, template));
    } catch (error) {
      this.logger.error({ err: error }, 'team change made, its e-mail not queued');
    }
  }

  /** Only to a confirmed address, as every account e-mail but the confirmation (A02). */
  private async enqueueIfConfirmed(
    userId: string,
    template: AccountNotificationTemplate,
  ): Promise<void> {
    const user = await this.platformTx.tx.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    // No account any more, or an address nobody confirmed: no e-mail.
    if ((user?.emailVerifiedAt ?? null) === null) return;
    await this.notifications.enqueue({
      userId,
      template,
      dedupeKey: `team-notice:${randomUUID()}`,
    });
  }
}

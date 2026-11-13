import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable } from '@nestjs/common';
import { PlatformPrismaService } from '../../common/database/platform-prisma.service.js';
import { isPrismaKnownRequestError } from '../../common/database/prisma-errors.js';
import { IntegrationRelay } from '../../common/tenancy/integration-relay.js';
import type { AccessChange } from '../../common/tenancy/practice-access-index.js';
import { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import { PracticeRunner } from '../../common/tenancy/practice-runner.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import type { StaffRole } from '../../generated/practice/enums.js';

/** The doctor named for the link is none of the practice's doctors: nothing changes. */
class NoSuchDoctorError extends Error {
  override readonly name = 'NoSuchDoctorError';
}

/** The base roles (D17): the practice team and the doctors; management is an add-on. */
export const STAFF_ROLES: readonly StaffRole[] = ['STAFF', 'DOCTOR'];

/** What the operator's command did, or why it did nothing. */
export type StaffRoleOutcome =
  | {
      readonly result: 'SET';
      readonly role: StaffRole;
      readonly managesPractice: boolean;
      /** An app was set up before this: the operator asks the person whether it was them (RT-96). */
      readonly mfaEnabled: boolean;
    }
  | { readonly result: 'REMOVED' }
  | {
      readonly result:
        | 'NO_PRACTICE'
        | 'ACCOUNT_NOT_FOUND'
        | 'EMAIL_NOT_VERIFIED'
        | 'NOT_A_MEMBER'
        | 'NO_SUCH_DOCTOR'
        | 'LINK_NEEDS_DOCTOR_ROLE'
        | 'DOCTOR_ALREADY_LINKED';
    };

/** What the operator gives along with a base role (D17). */
export interface StaffRoleOptions {
  /** Practice management: the first one comes from the operator, before anyone can give it. */
  readonly managesPractice?: boolean;
  /** The doctor this account is (M04); left out, the link stays as it was. */
  readonly providerId?: string;
}

/**
 * The operator's way to give an account its place in the installation's practice (A04, ADR 0016,
 * D17), before anyone in the practice can: for example the first person with practice management.
 * The account must exist with a confirmed address. The membership and its index event commit in one
 * practice transaction, and the index follows at once, or through the relay.
 */
@Injectable()
export class StaffRoles {
  constructor(
    private readonly platform: PlatformPrismaService,
    @InjectTransactionHost('practice') private readonly practiceTx: PracticeTransactionHost,
    private readonly runner: PracticeRunner,
    private readonly relay: IntegrationRelay,
    private readonly audit: PracticeAudit,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** `role` null: the membership ends, on the next request of that person. */
  async setRole(
    email: string,
    role: StaffRole | null,
    operator: string,
    { managesPractice = false, providerId }: StaffRoleOptions = {},
  ): Promise<StaffRoleOutcome> {
    const practiceId = await this.installationPracticeId();
    if (practiceId === undefined) return { result: 'NO_PRACTICE' };
    const user = await this.platform.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true, totpEnabledAt: true },
    });
    if (user === null) return { result: 'ACCOUNT_NOT_FOUND' };
    if (role !== null && user.emailVerifiedAt === null) return { result: 'EMAIL_NOT_VERIFIED' };
    // Only a doctor's account names the doctor it is (M04).
    if (providerId !== undefined && role !== 'DOCTOR') return { result: 'LINK_NEEDS_DOCTOR_ROLE' };
    const change: AccessChange = { userId: user.id, capacity: 'STAFF', active: role !== null };
    let changed: boolean;
    try {
      changed = await this.runner.runInPractice(
        practiceId,
        async () => {
          const version = await this.practiceTx.withTransaction(() =>
            this.write(user.id, role, managesPractice, operator, change, providerId),
          );
          if (version !== undefined) await this.relay.applyNow(practiceId, version, change);
          return version !== undefined;
        },
        { purpose: 'job' },
      );
    } catch (error) {
      if (error instanceof NoSuchDoctorError) return { result: 'NO_SUCH_DOCTOR' };
      if (isPrismaKnownRequestError(error) && error.code === 'P2002') {
        return { result: 'DOCTOR_ALREADY_LINKED' };
      }
      throw error;
    }
    if (role !== null) {
      return { result: 'SET', role, managesPractice, mfaEnabled: user.totpEnabledAt !== null };
    }
    return changed ? { result: 'REMOVED' } : { result: 'NOT_A_MEMBER' };
  }

  /** The membership, its audit row and its index event; undefined: nothing to remove. */
  private async write(
    userId: string,
    role: StaffRole | null,
    managesPractice: boolean,
    operator: string,
    change: AccessChange,
    providerId: string | undefined,
  ): Promise<bigint | undefined> {
    const db = this.practiceTx.tx;
    if (providerId !== undefined) {
      const doctor = await db.staffMember.findFirst({
        where: { id: providerId, isProvider: true },
        select: { id: true },
      });
      if (doctor === null) throw new NoSuchDoctorError();
    }
    if (role === null) {
      // An ended membership names no doctor: another account can be that doctor.
      const { count } = await db.membership.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'DISABLED', staffMemberId: null },
      });
      if (count === 0) return undefined;
    } else {
      // Only a doctor's account names a doctor; another role drops a link it had.
      const link =
        role !== 'DOCTOR'
          ? { staffMemberId: null }
          : providerId === undefined
            ? {}
            : { staffMemberId: providerId };
      const before = await db.membership.findUnique({
        where: { userId },
        select: { managesPractice: true, status: true },
      });
      await db.membership.upsert({
        where: { userId },
        create: { userId, role, managesPractice, ...link },
        update: { role, managesPractice, status: 'ACTIVE', ...link },
      });
      const managedBefore = before?.status === 'ACTIVE' && before.managesPractice;
      if (managedBefore !== managesPractice) {
        const { id: subjectId } = await db.membership.findUniqueOrThrow({
          where: { userId },
          select: { id: true },
        });
        await this.audit.recordOperator({
          operator,
          action: managesPractice ? 'staff.management.grant' : 'staff.management.revoke',
          subjectId,
        });
      }
    }
    const { id } = await db.membership.findUniqueOrThrow({
      where: { userId },
      select: { id: true },
    });
    await this.audit.recordOperator({
      operator,
      action: role === null ? 'staff.role.remove' : 'staff.role.set',
      subjectId: id,
    });
    // Linking an account to a doctor is a change of access: the doctor is named in its own row.
    if (providerId !== undefined && role !== null) {
      await this.audit.recordOperator({
        operator,
        action: 'staff.provider.link',
        subjectId: providerId,
      });
    }
    return this.relay.recordAccessChange(change);
  }

  private async installationPracticeId(): Promise<string | undefined> {
    const slug = this.env.PRACTICE_SLUG;
    if (slug === undefined) return undefined;
    const row = await this.platform.practiceSlug.findUnique({
      where: { slug },
      select: { practiceId: true },
    });
    return row?.practiceId;
  }
}

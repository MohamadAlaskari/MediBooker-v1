import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable } from '@nestjs/common';
import { PlatformPrismaService } from '../../common/database/platform-prisma.service.js';
import { IntegrationRelay } from '../../common/tenancy/integration-relay.js';
import type { AccessChange } from '../../common/tenancy/practice-access-index.js';
import { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import { PracticeRunner } from '../../common/tenancy/practice-runner.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import type { StaffRole } from '../../generated/practice/enums.js';

export const STAFF_ROLES: readonly StaffRole[] = ['STAFF', 'DOCTOR', 'ADMIN'];

/** What the operator's command did, or why it did nothing. */
export type StaffRoleOutcome =
  | {
      readonly result: 'SET';
      readonly role: StaffRole;
      /** An app was set up before this: the operator asks the person whether it was them (RT-96). */
      readonly mfaEnabled: boolean;
    }
  | { readonly result: 'REMOVED' }
  | {
      readonly result: 'NO_PRACTICE' | 'ACCOUNT_NOT_FOUND' | 'EMAIL_NOT_VERIFIED' | 'NOT_A_MEMBER';
    };

/**
 * The operator's way to give an account a role in the installation's practice (A04, ADR 0016),
 * before any admin exists who could invite one: for example the first admin. The account must
 * exist with a confirmed address. The membership and its index event commit in one practice
 * transaction, and the index follows at once, or through the relay.
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
  ): Promise<StaffRoleOutcome> {
    const practiceId = await this.installationPracticeId();
    if (practiceId === undefined) return { result: 'NO_PRACTICE' };
    const user = await this.platform.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true, totpEnabledAt: true },
    });
    if (user === null) return { result: 'ACCOUNT_NOT_FOUND' };
    if (role !== null && user.emailVerifiedAt === null) return { result: 'EMAIL_NOT_VERIFIED' };
    const change: AccessChange = { userId: user.id, capacity: 'STAFF', active: role !== null };
    const changed = await this.runner.runInPractice(
      practiceId,
      async () => {
        const version = await this.practiceTx.withTransaction(() =>
          this.write(user.id, role, operator, change),
        );
        if (version !== undefined) await this.relay.applyNow(practiceId, version, change);
        return version !== undefined;
      },
      { purpose: 'job' },
    );
    if (role !== null) return { result: 'SET', role, mfaEnabled: user.totpEnabledAt !== null };
    return changed ? { result: 'REMOVED' } : { result: 'NOT_A_MEMBER' };
  }

  /** The membership, its audit row and its index event; undefined: nothing to remove. */
  private async write(
    userId: string,
    role: StaffRole | null,
    operator: string,
    change: AccessChange,
  ): Promise<bigint | undefined> {
    const db = this.practiceTx.tx;
    if (role === null) {
      const { count } = await db.membership.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'DISABLED' },
      });
      if (count === 0) return undefined;
    } else {
      await db.membership.upsert({
        where: { userId },
        create: { userId, role },
        update: { role, status: 'ACTIVE' },
      });
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

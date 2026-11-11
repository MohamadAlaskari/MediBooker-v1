import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { auditActorOf } from '../security/platform-audit.js';
import { Clock } from '../time/clock.js';
import { dbInstantOf } from '../time/convert.js';
import { PracticeKeys } from './practice-keys.js';
import type { PracticeTransactionHost } from './practice-transactional.adapter.js';

export interface PracticeAuditEntry {
  readonly userId: string;
  /** A constant, such as `patient.join`. */
  readonly action: string;
  /** The row it happened to. */
  readonly subjectId: string;
  /** From `ipHashOf`. */
  readonly ipHash: string | null;
}

export interface PracticeOperatorAuditEntry {
  /** Who ran the command: `local:<OS user>` on a machine, the task's identity in the cloud. */
  readonly operator: string;
  /** A constant, such as `staff.role.set`. */
  readonly action: string;
  readonly subjectId: string;
}

/**
 * The audit log of a practice: append-only for the app role, written in the transaction of what it
 * records, without personal data beyond ids. The address is a keyed hash with a key of this practice,
 * so it cannot be compared with another practice's log (ADR 0005 §4.8).
 */
@Injectable()
export class PracticeAudit {
  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly clock: Clock,
    private readonly keys: PracticeKeys,
  ) {}

  /** Before the transaction: it may have to read a key. */
  async ipHashOf(practiceId: string, ip: string | undefined): Promise<string | null> {
    return ip === undefined ? null : this.keys.keyedHash(practiceId, 'ip-address', ip);
  }

  async record({ userId, action, subjectId, ipHash }: PracticeAuditEntry): Promise<void> {
    await this.txHost.tx.auditEvent.create({
      data: {
        at: dbInstantOf(this.clock.now()),
        actor: auditActorOf(userId),
        action,
        subjectId,
        ipHash,
      },
    });
  }

  /**
   * One row per subject in one statement: what a list showed to whom (BR-18), so that a question
   * about one patient's record finds a read of a list too.
   */
  async recordEach({
    userId,
    action,
    subjectIds,
    ipHash,
  }: Omit<PracticeAuditEntry, 'subjectId'> & {
    readonly subjectIds: readonly string[];
  }): Promise<void> {
    if (subjectIds.length === 0) return;
    const at = dbInstantOf(this.clock.now());
    const actor = auditActorOf(userId);
    await this.txHost.tx.auditEvent.createMany({
      data: subjectIds.map((subjectId) => ({ at, actor, action, subjectId, ipHash })),
    });
  }

  /**
   * Like recordEach, but not again for a subject this person had the same action on within the last
   * minutes: a list shown again and again is one read, not rows by the thousand that bury the others.
   */
  async recordEachUnlessRecent({
    userId,
    action,
    subjectIds,
    ipHash,
    minutes,
  }: Omit<PracticeAuditEntry, 'subjectId'> & {
    readonly subjectIds: readonly string[];
    readonly minutes: number;
  }): Promise<void> {
    if (subjectIds.length === 0) return;
    const recent = await this.txHost.tx.auditEvent.findMany({
      where: {
        actor: auditActorOf(userId),
        action,
        subjectId: { in: [...subjectIds] },
        at: { gte: dbInstantOf(this.clock.now().subtract({ minutes })) },
      },
      select: { subjectId: true },
    });
    const seen = new Set(recent.map(({ subjectId }) => subjectId));
    await this.recordEach({
      userId,
      action,
      subjectIds: subjectIds.filter((subjectId) => !seen.has(subjectId)),
      ipHash,
    });
  }

  /** What an operator did with a command, not a person through the API (A04). */
  async recordOperator({ operator, action, subjectId }: PracticeOperatorAuditEntry): Promise<void> {
    await this.txHost.tx.auditEvent.create({
      data: {
        at: dbInstantOf(this.clock.now()),
        actor: `operator:${operator}`,
        action,
        subjectId,
        ipHash: null,
      },
    });
  }
}

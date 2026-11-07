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
}

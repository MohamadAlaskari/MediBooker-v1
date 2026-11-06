import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PlatformTransactionHost } from '../database/platform-transactional.js';

export interface AccountAuditEntry {
  /** `user:<id>`, or `anonymous` when nobody could be named. Nothing else about a person. */
  readonly actor: string;
  /** A constant, such as `auth.login`. */
  readonly action: string;
  readonly outcome: 'SUCCEEDED' | 'FAILED';
  /** A code, never a message. */
  readonly errorCode?: string;
}

/**
 * The platform audit log of accounts (ADR 0004 §9): append-only for the app role, written in the
 * transaction of what it records, without personal data beyond the id.
 */
@Injectable()
export class PlatformAudit {
  constructor(
    @InjectTransactionHost('platform') private readonly txHost: PlatformTransactionHost,
  ) {}

  async record({ actor, action, outcome, errorCode }: AccountAuditEntry): Promise<void> {
    await this.txHost.tx.platformAuditEvent.create({
      data: { actor, action, outcome, errorCode: errorCode ?? null },
    });
  }
}

export function auditActorOf(userId: string): string {
  return `user:${userId}`;
}

export const ANONYMOUS_ACTOR = 'anonymous';

import { Injectable } from '@nestjs/common';
import type { PracticeCapacity } from '../../generated/platform/enums.js';
import { PlatformPrismaService } from '../database/platform-prisma.service.js';
import { Clock } from '../time/clock.js';
import { dbInstantOf } from '../time/convert.js';

/** A change of a person's capacity in a practice. It names no practice: its source does. */
export interface AccessChange {
  readonly userId: string;
  readonly capacity: PracticeCapacity;
  readonly active: boolean;
}

/** A practice of an account, as `GET /me/practices` lists it. */
export interface AccessiblePractice {
  readonly id: string;
  readonly slug: string | null;
  readonly name: unknown;
  readonly capacity: PracticeCapacity;
}

/** Practices a person can still be pointed to: not those being removed. */
const LISTED_STATUSES = ['ACTIVE', 'SUSPENDED', 'MOVING', 'RESTORE_REVIEW'] as const;

/**
 * The membership index in the platform database (ADR 0005 §1.1, §1.4), read before any practice
 * database is opened. It only says where to look: the practice database decides, and a missing or
 * lagging row denies.
 */
@Injectable()
export class PracticeAccessIndex {
  constructor(
    private readonly platform: PlatformPrismaService,
    private readonly clock: Clock,
  ) {}

  /** The capacities of a person in a practice; empty: the answer is 404, and no client is opened. */
  async capacitiesOf(userId: string, practiceId: string): Promise<readonly PracticeCapacity[]> {
    const rows = await this.platform.practiceAccess.findMany({
      where: { userId, practiceId, active: true },
      select: { capacity: true },
    });
    return rows.map(({ capacity }) => capacity);
  }

  async practicesOf(userId: string): Promise<readonly AccessiblePractice[]> {
    const rows = await this.platform.practiceAccess.findMany({
      where: { userId, active: true, practice: { status: { in: [...LISTED_STATUSES] } } },
      select: {
        capacity: true,
        practice: {
          select: {
            id: true,
            name: true,
            slugs: { where: { retiredAt: null }, select: { slug: true }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(({ capacity, practice }) => ({
      id: practice.id,
      slug: practice.slugs[0]?.slug ?? null,
      name: practice.name,
      capacity,
    }));
  }

  /** Whether the account's address is confirmed (BR-09): a session no longer means that. */
  async isVerified(userId: string): Promise<boolean> {
    const user = await this.platform.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    return user !== null && user.emailVerifiedAt !== null;
  }

  /**
   * Applies an event of this practice's outbox, at least once and in any order: an older version
   * changes nothing. A person who is gone in the meantime gets no row.
   */
  async apply(
    practiceId: string,
    version: bigint,
    { userId, capacity, active }: AccessChange,
  ): Promise<void> {
    const at = dbInstantOf(this.clock.now());
    await this.platform.$executeRaw`
      INSERT INTO practice_access
        (user_id, practice_id, capacity, active, source_version, created_at, updated_at)
      SELECT id, ${practiceId}::uuid, ${capacity}::practice_capacity, ${active}, ${version}, ${at}, ${at}
      FROM users WHERE id = ${userId}::uuid
      ON CONFLICT (user_id, practice_id, capacity) DO UPDATE
      SET active = EXCLUDED.active,
          source_version = EXCLUDED.source_version,
          updated_at = EXCLUDED.updated_at
      WHERE practice_access.source_version < EXCLUDED.source_version`;
  }
}

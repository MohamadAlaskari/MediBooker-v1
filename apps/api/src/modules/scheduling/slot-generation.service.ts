import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { Clock } from '../../common/time/clock.js';
import { dbDateOf, dbInstantOf, instantOf, plainDateOf } from '../../common/time/convert.js';
import { generateSlots } from './domain/slots.rules.js';

export interface SlotGenerationResult {
  readonly created: number;
  readonly removed: number;
}

function keyOf(providerId: string, startsAtMilliseconds: number): string {
  return `${providerId}@${String(startsAtMilliseconds)}`;
}

/**
 * Brings the future slots of the practice of the current context in line with its rules (BR-06).
 * Idempotent: the unique index and EXCLUDE skip what exists. Only OPEN slots are removed, so a
 * BOOKED or BLOCKED one survives any change of a rule (BR-07).
 */
@Injectable()
export class SlotGenerationService {
  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly clock: Clock,
  ) {}

  async generate(): Promise<SlotGenerationResult> {
    const db = this.txHost.tx;
    const now = this.clock.now();
    const settings = await db.practiceSettings.findUniqueOrThrow({ where: { id: 1 } });
    const { timeZone, weekendDays, maxHorizonDays } = settings;
    const from = now.toZonedDateTimeISO(timeZone).toPlainDate();
    const to = from.add({ days: maxHorizonDays });
    const [rules, absences, closedDays, open] = await Promise.all([
      db.availabilityRule.findMany({ where: { provider: { isProvider: true } } }),
      db.availabilityException.findMany({ where: { endsAt: { gt: dbInstantOf(now) } } }),
      db.specialDay.findMany({
        where: { closed: true, date: { gte: dbDateOf(from), lte: dbDateOf(to) } },
        select: { date: true },
      }),
      db.slot.findMany({
        where: { status: 'OPEN', startsAt: { gt: dbInstantOf(now) } },
        select: { id: true, providerId: true, startsAt: true },
      }),
    ]);

    const wanted = generateSlots({
      rules: rules.map((rule) => ({
        ...rule,
        validFrom: plainDateOf(rule.validFrom),
        validTo: rule.validTo === null ? null : plainDateOf(rule.validTo),
      })),
      absences: absences.map(({ providerId, startsAt, endsAt }) => ({
        providerId,
        startsAt: instantOf(startsAt),
        endsAt: instantOf(endsAt),
      })),
      closedDays: new Set(closedDays.map(({ date }) => plainDateOf(date).toString())),
      weekendDays,
      timeZone,
      from,
      to,
    }).filter(({ startsAt }) => Temporal.Instant.compare(startsAt, now) > 0);

    const wantedKeys = new Set(
      wanted.map(({ providerId, startsAt }) => keyOf(providerId, startsAt.epochMilliseconds)),
    );
    const stale = open
      .filter(({ providerId, startsAt }) => !wantedKeys.has(keyOf(providerId, startsAt.getTime())))
      .map(({ id }) => id);
    // First: a new slot may overlap one that is going, and EXCLUDE would skip it. The status is
    // asked again here, so a slot that was booked in the meantime stays.
    const { count: removed } = await db.slot.deleteMany({
      where: { id: { in: stale }, status: 'OPEN' },
    });
    const { count: created } = await db.slot.createMany({
      data: wanted.map(({ ruleId, providerId, startsAt, endsAt }) => ({
        ruleId,
        providerId,
        startsAt: dbInstantOf(startsAt),
        endsAt: dbInstantOf(endsAt),
      })),
      skipDuplicates: true,
    });
    return { created, removed };
  }
}

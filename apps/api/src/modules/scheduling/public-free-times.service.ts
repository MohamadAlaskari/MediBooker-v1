import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception.js';
import { FIELD_ERROR_MESSAGES } from '../../common/errors/field-error-codes.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf, instantOf } from '../../common/time/convert.js';
import type { Prisma } from '../../generated/practice/client.js';
import { PUBLIC_PROVIDER } from './domain/public-profile.js';
import {
  bookableWindow,
  dayRange,
  daysInRange,
  daysWithFreeTimes,
  type InstantRange,
  practiceBookableWindow,
} from './domain/slots.rules.js';
import type {
  PublicAvailabilityDto,
  PublicAvailabilityQueryDto,
  PublicFreeTimesDto,
  PublicFreeTimesQueryDto,
} from './public-free-times.dto.js';

/** At most this many days in one question about availability (08 P05). */
export const MAX_AVAILABILITY_DAYS = 42;

interface Offer {
  readonly serviceId: string;
  readonly providerId?: string | undefined;
}

/**
 * Who asks for free times: which services and which doctors by name they may ask about, and from
 * when to when they may book. Both see the same starts, without a slot id and without who has them.
 */
export interface FreeTimesAudience {
  readonly services: Prisma.ServiceWhereInput;
  readonly providers: Prisma.StaffMemberWhereInput;
  readonly window: (
    now: Temporal.Instant,
    settings: { readonly minLeadTimeMinutes: number; readonly maxHorizonDays: number },
  ) => { readonly earliest: Temporal.Instant; readonly latest: Temporal.Instant };
}

/** The public page and the patients (BR-03, BR-08, BR-22, BR-24). */
export const PUBLIC_AUDIENCE: FreeTimesAudience = {
  services: { active: true, isBookableOnline: true },
  providers: PUBLIC_PROVIDER,
  window: bookableWindow,
};

/** The team, booking for a patient (W7): every active service and doctor, from now on. */
export const PRACTICE_AUDIENCE: FreeTimesAudience = {
  services: { active: true },
  providers: { isProvider: true },
  window: practiceBookableWindow,
};

function laterOf(a: Temporal.Instant, b: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.compare(a, b) >= 0 ? a : b;
}

/**
 * The free times of the practice of the current request (BR-03, BR-08, BR-22), as its audience may
 * see them. A service or a provider outside the audience answers 404, like an id of another
 * practice, which this database does not know.
 */
@Injectable()
export class PublicFreeTimesService {
  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly clock: Clock,
  ) {}

  async availability(
    query: PublicAvailabilityQueryDto,
    audience: FreeTimesAudience = PUBLIC_AUDIENCE,
  ): Promise<PublicAvailabilityDto> {
    const settings = await this.settings();
    await this.assertOffered(query, audience);
    const { timeZone } = settings;
    const from =
      query.from === undefined
        ? this.clock.now().toZonedDateTimeISO(timeZone).toPlainDate()
        : Temporal.PlainDate.from(query.from);
    const to =
      query.to === undefined
        ? from.add({ days: MAX_AVAILABILITY_DAYS - 1 })
        : Temporal.PlainDate.from(query.to);
    const days = daysInRange(from, to);
    if (days < 1 || days > MAX_AVAILABILITY_DAYS) {
      throw new DomainException('VALIDATION_FAILED', {
        fieldErrors: [
          { field: 'to', code: 'INVALID_VALUE', message: FIELD_ERROR_MESSAGES.INVALID_VALUE },
        ],
      });
    }
    const starts = await this.freeStarts(
      query,
      { start: dayRange(from, timeZone).start, end: dayRange(to, timeZone).end },
      audience.window(this.clock.now(), settings),
    );
    return {
      days: daysWithFreeTimes(from, to, starts, timeZone).map(({ date, hasFreeTimes }) => ({
        date: date.toString(),
        hasFreeTimes,
      })),
    };
  }

  async freeTimesOfDay(
    query: PublicFreeTimesQueryDto,
    audience: FreeTimesAudience = PUBLIC_AUDIENCE,
  ): Promise<PublicFreeTimesDto> {
    const settings = await this.settings();
    await this.assertOffered(query, audience);
    const date = Temporal.PlainDate.from(query.date);
    const starts = await this.freeStarts(
      query,
      dayRange(date, settings.timeZone),
      audience.window(this.clock.now(), settings),
    );
    return {
      date: date.toString(),
      times: starts.map((start) => ({ startsAt: start.toString() })),
    };
  }

  private settings(): Promise<{
    readonly timeZone: string;
    readonly minLeadTimeMinutes: number;
    readonly maxHorizonDays: number;
  }> {
    return this.txHost.tx.practiceSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: { timeZone: true, minLeadTimeMinutes: true, maxHorizonDays: true },
    });
  }

  private async assertOffered(
    { serviceId, providerId }: Offer,
    audience: FreeTimesAudience,
  ): Promise<void> {
    const db = this.txHost.tx;
    const service = await db.service.findFirst({
      where: { id: serviceId, ...audience.services },
      select: { id: true },
    });
    if (service === null) throw new DomainException('NOT_FOUND');
    if (providerId === undefined) return;
    const provider = await db.staffMember.findFirst({
      where: { id: providerId, ...audience.providers },
      select: { id: true },
    });
    if (provider === null) throw new DomainException('NOT_FOUND');
  }

  /**
   * The starts, each once and without an id, grouped by the database: which doctor has a time stays
   * out of the answer, and so does how many have it. A booking picks the slot in its transaction.
   */
  private async freeStarts(
    { serviceId, providerId }: Offer,
    { start, end }: InstantRange,
    {
      earliest,
      latest,
    }: { readonly earliest: Temporal.Instant; readonly latest: Temporal.Instant },
  ): Promise<Temporal.Instant[]> {
    const rows = await this.txHost.tx.slot.groupBy({
      by: ['startsAt'],
      where: {
        status: 'OPEN',
        startsAt: {
          gte: dbInstantOf(laterOf(earliest, start)),
          lt: dbInstantOf(end),
          lte: dbInstantOf(latest),
        },
        ...(providerId === undefined ? {} : { providerId }),
        provider: { isProvider: true },
        rule: { services: { some: { serviceId } } },
      },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map(({ startsAt }) => instantOf(startsAt));
  }
}

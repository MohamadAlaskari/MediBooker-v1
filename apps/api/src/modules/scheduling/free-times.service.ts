import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { FIELD_ERROR_MESSAGES } from '../../common/errors/field-error-codes.js';
import { requirePracticeContext } from '../../common/tenancy/practice-context.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { RunningLimit } from '../../common/tenancy/running-limit.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf, instantOf } from '../../common/time/convert.js';
import type { Prisma } from '../../generated/practice/client.js';
import { freeStartsOf, type HoldLength } from './domain/hold.rules.js';
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
  AvailabilityDto,
  AvailabilityQueryDto,
  FreeTimesDto,
  FreeTimesQueryDto,
} from './free-times.dto.js';

/** At most this many days in one question about availability (08 P05). */
export const MAX_AVAILABILITY_DAYS = 42;

/**
 * At most this many answers of free times are made at once per practice, audience and instance;
 * more are 429 with Retry-After. Each answer reads every slot of its range (security review of M04
 * part 2), and the patients' do not take the team's places (security review of B07).
 */
export const FREE_TIMES_AT_ONCE = 4;

/**
 * And this many of one patient account at once, whatever its addresses: one person cannot take the
 * practice's places. A page asks for the days and the times of one day, two at a time.
 */
export const FREE_TIMES_AT_ONCE_PER_ACCOUNT = 2;

interface Offer {
  readonly serviceId: string;
  readonly providerId?: string | undefined;
}

/**
 * Who asks for free times: which services and which doctors by name they may ask about, and from
 * when to when they may book. Both see the same starts, without a slot id and without who has them.
 */
export interface FreeTimesAudience {
  /** Whose limit an answer counts against: the patients' and the team's are apart. */
  readonly name: 'patients' | 'team';
  readonly services: Prisma.ServiceWhereInput;
  readonly providers: Prisma.StaffMemberWhereInput;
  readonly window: (
    now: Temporal.Instant,
    settings: { readonly minLeadTimeMinutes: number; readonly maxHorizonDays: number },
  ) => { readonly earliest: Temporal.Instant; readonly latest: Temporal.Instant };
}

/** The patients, signed in (BR-03, BR-08, BR-22, BR-24). */
export const PATIENT_AUDIENCE: FreeTimesAudience = {
  name: 'patients',
  services: { active: true, isBookableOnline: true },
  providers: PUBLIC_PROVIDER,
  window: bookableWindow,
};

/** The team, booking for a patient (W7): every active service and doctor, from now on. */
export const PRACTICE_AUDIENCE: FreeTimesAudience = {
  name: 'team',
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
export class FreeTimesService {
  private readonly running = new RunningLimit();
  private readonly perAccount = new RunningLimit();

  constructor(
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly clock: Clock,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async availability(
    query: AvailabilityQueryDto,
    audience: FreeTimesAudience = PATIENT_AUDIENCE,
  ): Promise<AvailabilityDto> {
    const settings = await this.settings();
    const length = await this.assertOffered(query, audience);
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
    const starts = await this.atOnce(audience, () =>
      this.freeStarts(
        query,
        length,
        { start: dayRange(from, timeZone).start, end: dayRange(to, timeZone).end },
        audience.window(this.clock.now(), settings),
      ),
    );
    return {
      days: daysWithFreeTimes(from, to, starts, timeZone).map(({ date, hasFreeTimes }) => ({
        date: date.toString(),
        hasFreeTimes,
      })),
    };
  }

  async freeTimesOfDay(
    query: FreeTimesQueryDto,
    audience: FreeTimesAudience = PATIENT_AUDIENCE,
  ): Promise<FreeTimesDto> {
    const settings = await this.settings();
    const length = await this.assertOffered(query, audience);
    const date = Temporal.PlainDate.from(query.date);
    const starts = await this.atOnce(audience, () =>
      this.freeStarts(
        query,
        length,
        dayRange(date, settings.timeZone),
        audience.window(this.clock.now(), settings),
      ),
    );
    return {
      date: date.toString(),
      times: starts.map((start) => ({ startsAt: start.toString() })),
    };
  }

  /** The account's own places first: what it cannot have takes none of the practice's. */
  private atOnce<T>(audience: FreeTimesAudience, work: () => Promise<T>): Promise<T> {
    const { practice } = requirePracticeContext(this.cls);
    const inPractice = (): Promise<T> =>
      this.running.run(`${practice.id}:${audience.name}`, FREE_TIMES_AT_ONCE, work);
    const actor = this.cls.get('actor');
    if (audience.name === 'team' || actor === undefined) return inPractice();
    return this.perAccount.run(actor.userId, FREE_TIMES_AT_ONCE_PER_ACCOUNT, inPractice);
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

  /** The service's time, when the audience may ask for the service and the doctor (BR-27). */
  private async assertOffered(
    { serviceId, providerId }: Offer,
    audience: FreeTimesAudience,
  ): Promise<HoldLength> {
    const db = this.txHost.tx;
    const service = await db.service.findFirst({
      where: { id: serviceId, ...audience.services },
      select: { durationMinutes: true, bufferMinutes: true },
    });
    if (service === null) throw new DomainException('NOT_FOUND');
    if (providerId !== undefined) {
      const provider = await db.staffMember.findFirst({
        where: { id: providerId, ...audience.providers },
        select: { id: true },
      });
      if (provider === null) throw new DomainException('NOT_FOUND');
    }
    return service;
  }

  /**
   * The starts, each once and without an id: which doctor has a time stays out of the answer, and so
   * does how many have it. A start is free when its doctor is free from it for the service's
   * duration and buffer (BR-27), by the rule a booking applies; the booking picks the doctor and
   * holds the time in its transaction.
   */
  private async freeStarts(
    { serviceId, providerId }: Offer,
    length: HoldLength,
    { start, end }: InstantRange,
    {
      earliest,
      latest,
    }: { readonly earliest: Temporal.Instant; readonly latest: Temporal.Instant },
  ): Promise<Temporal.Instant[]> {
    const db = this.txHost.tx;
    // Only the doctors whose rules offer the service, one query after the other: a practice has
    // few connections (PRACTICE_POOL_MAX).
    const rules = await db.availabilityRule.findMany({
      where: {
        services: { some: { serviceId } },
        ...(providerId === undefined ? {} : { providerId }),
      },
      select: { id: true, providerId: true },
    });
    if (rules.length === 0) return [];
    const offers = new Set(rules.map(({ id }) => id));
    const doctors = [...new Set(rules.map((rule) => rule.providerId))];
    const from = laterOf(earliest, start);
    // The time of the last start reaches past the range by the duration and the buffer.
    const reach = end.add({ minutes: length.durationMinutes + length.bufferMinutes });
    const rows = await db.slot.findMany({
      where: {
        providerId: { in: doctors },
        startsAt: { gte: dbInstantOf(from), lt: dbInstantOf(reach) },
        provider: { isProvider: true },
      },
      select: {
        id: true,
        providerId: true,
        startsAt: true,
        endsAt: true,
        status: true,
        heldById: true,
        ruleId: true,
      },
    });
    const slots = rows.map((row) => ({
      ...row,
      startsAt: instantOf(row.startsAt),
      endsAt: instantOf(row.endsAt),
    }));
    return freeStartsOf(
      slots,
      ({ status, ruleId, startsAt }) =>
        status === 'OPEN' &&
        ruleId !== null &&
        offers.has(ruleId) &&
        Temporal.Instant.compare(startsAt, end) < 0 &&
        Temporal.Instant.compare(startsAt, latest) <= 0,
      length,
    );
  }
}

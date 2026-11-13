import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context.js';
import { isUuid } from '../../common/context/request-id.js';
import { driverFailureOf, isPrismaKnownRequestError } from '../../common/database/prisma-errors.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { Actor } from '../../common/security/actor.js';
import { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import { requirePracticeContext } from '../../common/tenancy/practice-context.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { RunningLimit } from '../../common/tenancy/running-limit.js';
import { Clock } from '../../common/time/clock.js';
import { dbDateOf, plainDateOf } from '../../common/time/convert.js';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { dateOfInput } from '../appointments/desk-rows.js';
import { clockOf } from '../public-practice/public-practice.mapper.js';
import {
  intervalsOf,
  LINE_TEXT,
  SPECIAL_DAY_HORIZON_DAYS,
  SPECIAL_DAY_LABEL_MAX,
  specialDayOf,
  textsOf,
} from './domain/practice-setup.rules.js';
import { validationFailed } from './practice-setup.errors.js';
import type {
  OpeningHoursDto,
  OpeningHoursInputDto,
  SpecialDayDto,
  SpecialDayInputDto,
  SpecialDayListDto,
} from './practice-setup.dto.js';

/** The audit actions of the practice's hours. */
export const HOURS_AUDIT = {
  replace: 'opening_hours.replace',
  addDay: 'special_day.create',
  removeDay: 'special_day.delete',
} as const;

/** The SQLSTATE of an EXCLUDE constraint's violation. */
const EXCLUSION_VIOLATION = '23P01';

const DISPLAY = { timeZone: true, numberingSystem: true, hourCycle: true } as const;

interface SpecialDayRow {
  readonly id: string;
  readonly date: Date;
  readonly closed: boolean;
  readonly opensAt: number | null;
  readonly closesAt: number | null;
  readonly label: unknown;
}

function specialDayView(row: SpecialDayRow): SpecialDayDto {
  return {
    id: row.id,
    date: plainDateOf(row.date).toString(),
    closed: row.closed,
    opensAt: row.opensAt === null ? null : clockOf(row.opensAt),
    closesAt: row.closesAt === null ? null : clockOf(row.closesAt),
    label: row.label as Readonly<Record<string, string>>,
  };
}

/**
 * When the practice is open (M02, W20): its week and its special days. The public page shows them
 * (BR-22); the doctors' working hours, which make the bookable times, are apart (M04). The practice
 * team and practice management change them; every member of the team reads them (D17).
 */
@Injectable()
export class PracticeHours {
  /** One new week of a practice at a time, per instance: a second is 429 before it waits. */
  private readonly replacing = new RunningLimit();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly cls: ClsService<RequestContext>,
    private readonly clock: Clock,
    private readonly audit: PracticeAudit,
  ) {}

  async week(): Promise<OpeningHoursDto> {
    const db = this.txHost.tx;
    const settings = await db.practiceSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: { ...DISPLAY, weekStart: true, weekendDays: true },
    });
    const intervals = await db.openingHours.findMany({
      orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }],
    });
    return {
      intervals: intervals.map(({ weekday, opensAt, closesAt }) => ({
        weekday,
        opensAt: clockOf(opensAt),
        closesAt: clockOf(closesAt),
      })),
      weekStart: settings.weekStart,
      weekendDays: settings.weekendDays,
      timeZone: settings.timeZone,
      numberingSystem: settings.numberingSystem,
      hourCycle: settings.hourCycle,
    };
  }

  /**
   * The whole week at once. Two intervals of a day that overlap are the database's to find (the
   * EXCLUDE of P01): each is written in the order given, so the error names the later one. The table
   * lock keeps a second week from meeting the first one's rows; a wait for it ends after
   * DATABASE_LOCK_TIMEOUT_MS (503), and a second week of the same practice in this instance is 429
   * before it takes a connection, so a burst cannot hold the practice's few connections (security
   * review of M02).
   */
  async replaceWeek(
    { userId }: Actor,
    input: OpeningHoursInputDto,
    ip: string | undefined,
  ): Promise<OpeningHoursDto> {
    const { practice } = requirePracticeContext(this.cls);
    const { problems, value } = intervalsOf(input.intervals);
    if (problems.length > 0) throw validationFailed(problems);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    await this.replacing.run(practice.id, 1, () =>
      this.txHost.withTransaction(async () => {
        const tx = this.txHost.tx;
        const lockWait = `${String(this.env.DATABASE_LOCK_TIMEOUT_MS)}ms`;
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${lockWait}, true)`;
        // One week at a time: a second would see the first one's new rows as an overlap.
        await tx.$executeRaw`LOCK TABLE opening_hours IN SHARE ROW EXCLUSIVE MODE`;
        await tx.openingHours.deleteMany();
        for (const [index, row] of value.entries()) {
          try {
            await tx.openingHours.create({ data: row, select: { id: true } });
          } catch (error) {
            if (driverFailureOf(error)?.sqlState !== EXCLUSION_VIOLATION) throw error;
            throw validationFailed([
              { field: `intervals[${String(index)}]`, code: 'OVERLAPS_EXISTING' },
            ]);
          }
        }
        await this.audit.record({
          userId,
          action: HOURS_AUDIT.replace,
          subjectId: practice.id,
          ipHash,
        });
      }),
    );
    return this.week();
  }

  async specialDays(): Promise<SpecialDayListDto> {
    const db = this.txHost.tx;
    const settings = await db.practiceSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: { ...DISPLAY, supportedLocales: true },
    });
    const today = this.clock.now().toZonedDateTimeISO(settings.timeZone).toPlainDate();
    const days = await db.specialDay.findMany({
      where: { date: { gte: dbDateOf(today) } },
      orderBy: { date: 'asc' },
      take: SPECIAL_DAY_HORIZON_DAYS + 1,
    });
    return {
      specialDays: days.map(specialDayView),
      today: today.toString(),
      locales: settings.supportedLocales,
      timeZone: settings.timeZone,
      numberingSystem: settings.numberingSystem,
      hourCycle: settings.hourCycle,
    };
  }

  async addSpecialDay(
    { userId }: Actor,
    input: SpecialDayInputDto,
    ip: string | undefined,
  ): Promise<SpecialDayDto> {
    const { practice } = requirePracticeContext(this.cls);
    const settings = await this.txHost.tx.practiceSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: { timeZone: true, supportedLocales: true },
    });
    const today = this.clock.now().toZonedDateTimeISO(settings.timeZone).toPlainDate();
    const date = dateOfInput(input.date, 'date');
    const hours = specialDayOf(
      { date, closed: input.closed, opensAt: input.opensAt, closesAt: input.closesAt },
      today,
    );
    const label = textsOf('label', input.label ?? {}, settings.supportedLocales, {
      required: false,
      max: SPECIAL_DAY_LABEL_MAX,
      pattern: LINE_TEXT,
    });
    const problems = [...hours.problems, ...label.problems];
    if (problems.length > 0) throw validationFailed(problems);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    const created = await this.txHost.withTransaction(async () => {
      let row: SpecialDayRow;
      try {
        row = await this.txHost.tx.specialDay.create({
          data: {
            date: dbDateOf(date),
            closed: input.closed,
            opensAt: hours.value.opensAt,
            closesAt: hours.value.closesAt,
            label: label.value,
          },
        });
      } catch (error) {
        if (!isPrismaKnownRequestError(error) || error.code !== 'P2002') throw error;
        throw validationFailed([{ field: 'date', code: 'ALREADY_EXISTS' }]);
      }
      await this.audit.record({ userId, action: HOURS_AUDIT.addDay, subjectId: row.id, ipHash });
      return row;
    });
    return specialDayView(created);
  }

  async removeSpecialDay(
    { userId }: Actor,
    specialDayId: string,
    ip: string | undefined,
  ): Promise<void> {
    const { practice } = requirePracticeContext(this.cls);
    if (!isUuid(specialDayId)) throw new DomainException('NOT_FOUND');
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    await this.txHost.withTransaction(async () => {
      const { count } = await this.txHost.tx.specialDay.deleteMany({
        where: { id: specialDayId },
      });
      if (count === 0) throw new DomainException('NOT_FOUND');
      await this.audit.record({
        userId,
        action: HOURS_AUDIT.removeDay,
        subjectId: specialDayId,
        ipHash,
      });
    });
  }
}

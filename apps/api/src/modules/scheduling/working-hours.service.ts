import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context.js';
import { isUuid } from '../../common/context/request-id.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { FIELD_ERROR_MESSAGES } from '../../common/errors/field-error-codes.js';
import { MAX_FIELD_ERRORS } from '../../common/errors/validation.js';
import type { Actor } from '../../common/security/actor.js';
import { PracticeAudit } from '../../common/tenancy/practice-audit.js';
import { requirePracticeContext } from '../../common/tenancy/practice-context.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import { RunningLimit } from '../../common/tenancy/running-limit.js';
import { Clock } from '../../common/time/clock.js';
import { dbDateOf, dbInstantOf, instantOf } from '../../common/time/convert.js';
import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { dateOfInput } from '../appointments/desk-rows.js';
import {
  absencePeriodOf,
  type FieldProblem,
  isAllDay,
  workingWeekOf,
} from './domain/working-hours.rules.js';
import { generationLockKey, SlotGenerationService } from './slot-generation.service.js';
import type {
  AbsenceCreatedDto,
  AbsenceDto,
  AbsenceInputDto,
  AbsenceListDto,
  ScheduleSlotDto,
  SlotChangeDto,
  SlotGenerationDto,
  WorkingHoursDto,
  WorkingHoursInputDto,
} from './working-hours.dto.js';

/** The audit actions of the doctors' schedules (M04). */
export const SCHEDULE_AUDIT = {
  replace: 'working_hours.replace',
  addAbsence: 'absence.create',
  removeAbsence: 'absence.delete',
  generate: 'slots.generate',
  block: 'slot.block',
  unblock: 'slot.unblock',
} as const;

const DISPLAY = {
  timeZone: true,
  numberingSystem: true,
  hourCycle: true,
  weekStart: true,
} as const;

function validationFailed(problems: readonly FieldProblem[]): DomainException {
  return new DomainException('VALIDATION_FAILED', {
    fieldErrors: problems.slice(0, MAX_FIELD_ERRORS).map(({ field, code }) => ({
      field,
      code,
      message: FIELD_ERROR_MESSAGES[code],
    })),
  });
}

function clockOf(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The value most rules of a doctor have, so that an older mix still shows one. */
function mostCommon(values: readonly number[]): number | null {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | null = null;
  for (const [value, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) best = value;
  }
  return best;
}

/** How the practice writes dates and times, and how its week runs: a plain object to spread. */
interface ScheduleDisplay {
  readonly timeZone: string;
  readonly numberingSystem: string;
  readonly hourCycle: string;
  readonly weekStart: number;
  readonly today: string;
}

/** An absence as a plain object, so that a created one can spread it. */
type AbsenceView = Pick<AbsenceDto, keyof AbsenceDto>;

interface AbsenceRow {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly reason: AbsenceDto['reason'];
}

/**
 * A doctor's working hours, absences and times (M04, W14, BR-06, BR-07). The reception and the
 * admin plan every doctor; a doctor plans itself only, and another doctor is not there for it (404),
 * like a doctor whose account names no doctor yet (M03 links them). Every change makes the free
 * times anew at once: a booked or blocked time stays as it is.
 */
@Injectable()
export class WorkingHours {
  /** One change of a doctor's week at a time, per instance: a second is 429 before it waits. */
  private readonly changing = new RunningLimit();
  /** One run of every doctor's free times at a time, per instance: a second is 429. */
  private readonly generating = new RunningLimit();
  /**
   * The doctors whose free times are being made in this instance. A change meanwhile does not wait
   * for that run, holding a connection of the practice's few: it asks the run to go once more, so
   * that the run reads the change (security review of M04).
   */
  private readonly regenerating = new Map<string, { again: boolean }>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @InjectTransactionHost('practice') private readonly txHost: PracticeTransactionHost,
    private readonly cls: ClsService<RequestContext>,
    private readonly clock: Clock,
    private readonly audit: PracticeAudit,
    private readonly generation: SlotGenerationService,
  ) {}

  async week(providerId: string): Promise<WorkingHoursDto> {
    await this.providerOf(providerId);
    const db = this.txHost.tx;
    const { display, today } = await this.displayOf();
    const now = this.clock.now();
    const rules = await db.availabilityRule.findMany({
      where: {
        providerId,
        OR: [{ validTo: null }, { validTo: { gte: dbDateOf(today) } }],
      },
      select: {
        weekday: true,
        startMinute: true,
        endMinute: true,
        slotMinutes: true,
        services: { select: { serviceId: true } },
      },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });
    const intervals = new Map<string, WorkingHoursDto['intervals'][number]>();
    for (const { weekday, startMinute, endMinute } of rules) {
      intervals.set(`${String(weekday)}@${String(startMinute)}-${String(endMinute)}`, {
        weekday,
        startsAt: clockOf(startMinute),
        endsAt: clockOf(endMinute),
      });
    }
    const serviceIds = [
      ...new Set(rules.flatMap(({ services }) => services.map((s) => s.serviceId))),
    ];
    const free = {
      providerId,
      status: 'OPEN',
      ruleId: { not: null },
      startsAt: { gt: dbInstantOf(now) },
    } as const;
    const [freeTimes, last] = await Promise.all([
      db.slot.count({ where: free }),
      db.slot.findFirst({ where: free, orderBy: { startsAt: 'desc' }, select: { startsAt: true } }),
    ]);
    return {
      ...display,
      providerId,
      slotMinutes: mostCommon(rules.map(({ slotMinutes }) => slotMinutes)),
      intervals: [...intervals.values()],
      serviceIds: serviceIds.toSorted(),
      booking: {
        freeTimes,
        openUntil:
          last === null
            ? null
            : instantOf(last.startsAt)
                .toZonedDateTimeISO(display.timeZone)
                .toPlainDate()
                .toString(),
      },
    };
  }

  /**
   * A doctor's new week from today: the rules that held until now end yesterday (or go, when they
   * start today or later), new ones start today with the chosen services, and the free times are
   * made anew. A booked or blocked time stays (BR-07); a free one that holds a cancelled
   * appointment's history stays too, without a rule until a new one wants its time.
   */
  async replaceWeek(
    { userId }: Actor,
    providerId: string,
    input: WorkingHoursInputDto,
    ip: string | undefined,
  ): Promise<WorkingHoursDto> {
    const { practice } = requirePracticeContext(this.cls);
    await this.providerOf(providerId);
    const { today } = await this.displayOf();
    const week = workingWeekOf(input.intervals, input.slotMinutes);
    const serviceIds = [...new Set(input.serviceIds)];
    const known = await this.txHost.tx.service.findMany({
      where: { id: { in: serviceIds }, active: true },
      select: { id: true },
    });
    const knownIds = new Set(known.map(({ id }) => id));
    const problems: FieldProblem[] = [
      ...week.problems,
      ...input.serviceIds.flatMap((id, index) =>
        knownIds.has(id)
          ? []
          : [{ field: `serviceIds[${String(index)}]`, code: 'INVALID_VALUE' } as const],
      ),
      ...(week.value.length > 0 && serviceIds.length === 0
        ? [{ field: 'serviceIds', code: 'REQUIRED' } as const]
        : []),
    ];
    if (problems.length > 0) throw validationFailed(problems);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    const now = this.clock.now();
    await this.changing.run(providerId, 1, () =>
      this.txHost.withTransaction(async () => {
        const tx = this.txHost.tx;
        await this.lockWait();
        // One week of a doctor at a time across instances: the doctor's row is its lock.
        // NO KEY: the foreign keys that name the doctor (its slots, absences) do not wait for it.
        await tx.$queryRaw`SELECT id FROM staff_members WHERE id = ${providerId}::uuid FOR NO KEY UPDATE`;
        const current = {
          providerId,
          OR: [{ validTo: null }, { validTo: { gte: dbDateOf(today) } }],
        };
        await tx.availabilityRule.updateMany({
          where: { ...current, validFrom: { lt: dbDateOf(today) } },
          data: { validTo: dbDateOf(today.subtract({ days: 1 })) },
        });
        await tx.availabilityRule.deleteMany({
          where: { ...current, validFrom: { gte: dbDateOf(today) } },
        });
        for (const { weekday, startMinute, endMinute } of week.value) {
          await tx.availabilityRule.create({
            data: {
              providerId,
              weekday,
              startMinute,
              endMinute,
              slotMinutes: input.slotMinutes,
              validFrom: dbDateOf(today),
              services: { create: serviceIds.map((serviceId) => ({ serviceId })) },
            },
            select: { id: true },
          });
        }
        // The doctor's free times to come are made anew by the new rules, with their services.
        // No run of the doctor's free times meanwhile, and the doctor's slots to come locked in the
        // order of their starts, as every path that waits for slot locks takes them (TimeHolds).
        const key = generationLockKey(providerId);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        await tx.$queryRaw`
          SELECT id FROM slots WHERE provider_id = ${providerId}::uuid
            AND starts_at > ${dbInstantOf(now)} ORDER BY starts_at FOR UPDATE`;
        const later = { providerId, startsAt: { gt: dbInstantOf(now) } } as const;
        await tx.slot.deleteMany({
          where: { ...later, status: 'OPEN', appointments: { none: {} } },
        });
        // Every time to come leaves the rules of before, also a booked or blocked one: freed again,
        // it is offered only once a new rule wants it, never with services the doctor gave up.
        await tx.slot.updateMany({ where: later, data: { ruleId: null } });
        await this.audit.record({
          userId,
          action: SCHEDULE_AUDIT.replace,
          subjectId: providerId,
          ipHash,
        });
      }),
    );
    await this.regenerate(providerId);
    return this.week(providerId);
  }

  async absences(providerId: string): Promise<AbsenceListDto> {
    await this.providerOf(providerId);
    const { display } = await this.displayOf();
    const rows = await this.txHost.tx.availabilityException.findMany({
      where: { providerId, endsAt: { gt: dbInstantOf(this.clock.now()) } },
      orderBy: { startsAt: 'asc' },
      select: { id: true, startsAt: true, endsAt: true, reason: true },
    });
    return { ...display, absences: rows.map((row) => this.absenceView(row, display.timeZone)) };
  }

  /** An absence, then the free times in it go; the booked appointments in it are counted. */
  async addAbsence(
    { userId }: Actor,
    providerId: string,
    input: AbsenceInputDto,
    ip: string | undefined,
  ): Promise<AbsenceCreatedDto> {
    const { practice } = requirePracticeContext(this.cls);
    await this.providerOf(providerId);
    const { display } = await this.displayOf();
    const period = absencePeriodOf(
      {
        startDate: dateOfInput(input.startDate, 'startDate'),
        endDate: dateOfInput(input.endDate, 'endDate'),
        startTime: input.startTime,
        endTime: input.endTime,
      },
      display.timeZone,
      this.clock.now(),
    );
    if (period.value === undefined) throw validationFailed(period.problems);
    const { startsAt, endsAt } = period.value;
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    const row = await this.txHost.withTransaction(async () => {
      const created = await this.txHost.tx.availabilityException.create({
        data: {
          providerId,
          startsAt: dbInstantOf(startsAt),
          endsAt: dbInstantOf(endsAt),
          reason: input.reason,
        },
        select: { id: true, startsAt: true, endsAt: true, reason: true },
      });
      await this.audit.record({
        userId,
        action: SCHEDULE_AUDIT.addAbsence,
        subjectId: created.id,
        ipHash,
      });
      return created;
    });
    // Every visit the absence touches, also one that began before it (BR-27).
    const bookedInside = await this.txHost.tx.appointment.count({
      where: {
        status: 'BOOKED',
        endsAt: { gt: dbInstantOf(startsAt) },
        slot: { providerId, startsAt: { lt: dbInstantOf(endsAt) } },
      },
    });
    await this.regenerate(providerId);
    return { ...this.absenceView(row, display.timeZone), bookedInside };
  }

  async removeAbsence(
    { userId }: Actor,
    providerId: string,
    absenceId: string,
    ip: string | undefined,
  ): Promise<void> {
    const { practice } = requirePracticeContext(this.cls);
    await this.providerOf(providerId);
    if (!isUuid(absenceId)) throw new DomainException('NOT_FOUND');
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    await this.txHost.withTransaction(async () => {
      const { count } = await this.txHost.tx.availabilityException.deleteMany({
        where: { id: absenceId, providerId },
      });
      if (count === 0) throw new DomainException('NOT_FOUND');
      await this.audit.record({
        userId,
        action: SCHEDULE_AUDIT.removeAbsence,
        subjectId: absenceId,
        ipHash,
      });
    });
    await this.regenerate(providerId);
  }

  /** The free times of every doctor made anew from the rules (BR-06): a second run adds nothing. */
  async generate({ userId }: Actor, ip: string | undefined): Promise<SlotGenerationDto> {
    const { practice } = requirePracticeContext(this.cls);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    const result = await this.generating.run(practice.id, 1, () => this.generation.generate());
    await this.audit.record({
      userId,
      action: SCHEDULE_AUDIT.generate,
      subjectId: practice.id,
      ipHash,
    });
    return result;
  }

  /**
   * Blocks a free time or frees a blocked one (BR-07): a time an appointment holds is
   * SLOT_HAS_APPOINTMENT, because the team cancels or moves the appointment first. A retry of a
   * change that is there already answers alike and writes nothing.
   */
  async changeSlot(
    { userId }: Actor,
    slotId: string,
    { status }: SlotChangeDto,
    ip: string | undefined,
  ): Promise<ScheduleSlotDto> {
    const { practice } = requirePracticeContext(this.cls);
    if (!isUuid(slotId)) throw new DomainException('NOT_FOUND');
    const slot = await this.txHost.tx.slot.findUnique({
      where: { id: slotId },
      select: { providerId: true },
    });
    if (slot === null) throw new DomainException('NOT_FOUND');
    await this.providerOf(slot.providerId);
    const ipHash = await this.audit.ipHashOf(practice.id, ip);
    // True when a blocked time came free: its doctor's free times are made anew after the commit.
    const freed = await this.txHost.withTransaction(async () => {
      const tx = this.txHost.tx;
      await this.lockWait();
      const [row] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM slots WHERE id = ${slotId}::uuid FOR UPDATE`;
      if (row === undefined) throw new DomainException('NOT_FOUND');
      if (row.status === 'BOOKED') throw new DomainException('SLOT_HAS_APPOINTMENT');
      if (row.status === status) return false;
      await tx.slot.update({ where: { id: slotId }, data: { status }, select: { id: true } });
      await this.audit.record({
        userId,
        action: status === 'BLOCKED' ? SCHEDULE_AUDIT.block : SCHEDULE_AUDIT.unblock,
        subjectId: slotId,
        ipHash,
      });
      return status === 'OPEN';
    });
    if (freed) await this.regenerate(slot.providerId);
    const changed = await this.txHost.tx.slot.findUniqueOrThrow({
      where: { id: slotId },
      select: { id: true, providerId: true, startsAt: true, endsAt: true, status: true },
    });
    return {
      id: changed.id,
      providerId: changed.providerId,
      startsAt: instantOf(changed.startsAt).toString(),
      endsAt: instantOf(changed.endsAt).toString(),
      status: changed.status,
    };
  }

  /**
   * A doctor's free times made anew after a change. When a run for the doctor is under way in this
   * instance, it goes once more after it ends, and this change does not wait for it.
   */
  private async regenerate(providerId: string): Promise<void> {
    const running = this.regenerating.get(providerId);
    if (running !== undefined) {
      running.again = true;
      return;
    }
    const state = { again: true };
    this.regenerating.set(providerId, state);
    try {
      while (state.again) {
        state.again = false;
        await this.generation.generateFor(providerId);
      }
    } finally {
      this.regenerating.delete(providerId);
    }
  }

  /**
   * The doctor a route names: one of the practice's doctors, and for a doctor its own only. Another
   * one is not there for it (404), as for anyone a doctor that does not exist.
   */
  private async providerOf(providerId: string): Promise<void> {
    const { staff } = requirePracticeContext(this.cls);
    if (staff === undefined) throw new Error('schedule route without a staff membership');
    if (!isUuid(providerId)) throw new DomainException('NOT_FOUND');
    if (staff.role === 'DOCTOR' && staff.providerId !== providerId) {
      throw new DomainException('NOT_FOUND');
    }
    const provider = await this.txHost.tx.staffMember.findFirst({
      where: { id: providerId, isProvider: true },
      select: { id: true },
    });
    if (provider === null) throw new DomainException('NOT_FOUND');
  }

  private async displayOf(): Promise<{
    readonly display: ScheduleDisplay;
    readonly today: Temporal.PlainDate;
  }> {
    const settings = await this.txHost.tx.practiceSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: DISPLAY,
    });
    const today = this.clock.now().toZonedDateTimeISO(settings.timeZone).toPlainDate();
    return { display: { ...settings, today: today.toString() }, today };
  }

  /** A wait for a row lock ends after DATABASE_LOCK_TIMEOUT_MS (503), in this transaction only. */
  private async lockWait(): Promise<void> {
    const lockWait = `${String(this.env.DATABASE_LOCK_TIMEOUT_MS)}ms`;
    await this.txHost.tx.$executeRaw`SELECT set_config('lock_timeout', ${lockWait}, true)`;
  }

  private absenceView(row: AbsenceRow, timeZone: string): AbsenceView {
    const period = { startsAt: instantOf(row.startsAt), endsAt: instantOf(row.endsAt) };
    return {
      id: row.id,
      startsAt: period.startsAt.toString(),
      endsAt: period.endsAt.toString(),
      reason: row.reason,
      allDay: isAllDay(period, timeZone),
    };
  }
}

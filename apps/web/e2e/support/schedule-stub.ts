/**
 * The doctors' schedules (M04) as the API answers them, in memory per staff account, so that tests
 * in parallel do not meet: working hours, absences, the free times made from them, and a time
 * blocked or freed. The rules a screen shows are the API's: a doctor plans only itself, an overlap
 * is named by its interval, a booked time cannot be blocked (`working-hours.int-spec.ts` proves
 * them on real databases).
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  AbsenceDto,
  AbsenceInputDto,
  WorkingHoursDto,
  WorkingHoursInputDto,
  WorkingIntervalDto,
} from '@medibooker/api-client';
import { bodyOf, done, problem, respond } from './answers.ts';
import { changeSlot } from './desk-booking-stub.ts';
import { CHECK_UP_ID, type DeskAccess, PROVIDER_ID, SETTINGS, TODAY } from './desk-stub.ts';

/** The second doctor of the stub practice. */
const OTHER_DOCTOR_ID = '70000000-0000-4000-8000-000000000002';
const DOCTORS = new Set([PROVIDER_ID, OTHER_DOCTOR_ID]);
/** Riyadh: the week starts on Sunday; the stub's clock stands on its today. */
const DISPLAY = { ...SETTINGS, weekStart: 7, today: TODAY };
const RIYADH_OFFSET_MS = 3 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const PATH =
  /^\/api\/v1\/practices\/[^/]+\/(?:providers\/([^/]+)\/(working-hours|absences)(?:\/([^/]+))?|slots\/(generate|[^/]+))$/;

interface Schedule {
  week: { slotMinutes: number; intervals: WorkingIntervalDto[]; serviceIds: string[] };
  absences: AbsenceDto[];
}

const schedules = new Map<string, Schedule>();

function scheduleOf(owner: string, providerId: string): Schedule {
  const key = `${owner}:${providerId}`;
  const known = schedules.get(key);
  if (known !== undefined) return known;
  const fresh: Schedule = {
    week: {
      slotMinutes: 30,
      intervals: [7, 1, 2, 3, 4].flatMap((weekday) => [
        { weekday, startsAt: '08:00', endsAt: '12:00' },
        { weekday, startsAt: '13:00', endsAt: '16:00' },
      ]),
      serviceIds: [CHECK_UP_ID],
    },
    absences: [],
  };
  schedules.set(key, fresh);
  return fresh;
}

function weekAnswer(providerId: string, schedule: Schedule): WorkingHoursDto {
  return {
    ...DISPLAY,
    providerId,
    ...schedule.week,
    booking: { openUntil: '2027-02-06', freeTimes: 120 },
  };
}

/** A local time of the stub's Riyadh as an instant: three hours ahead of UTC, no change of clock. */
function instantOf(date: string, clock: string): number {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number);
  return Date.parse(`${date}T00:00:00Z`) + (hours * 60 + minutes) * 60_000 - RIYADH_OFFSET_MS;
}

const iso = (time: number): string => new Date(time).toISOString().replace('.000', '');

async function answerWeek(
  schedule: Schedule,
  providerId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === 'PUT') {
    const input = await bodyOf<WorkingHoursInputDto>(request);
    const overlap = input.intervals.findIndex((interval, index) =>
      input.intervals
        .slice(0, index)
        .some(
          (other) =>
            other.weekday === interval.weekday &&
            other.startsAt < interval.endsAt &&
            interval.startsAt < other.endsAt,
        ),
    );
    if (overlap >= 0) {
      problem(response, 'VALIDATION_FAILED', {
        errors: [{ field: `intervals[${String(overlap)}]`, code: 'OVERLAPS_EXISTING' }],
      });
      return;
    }
    if (input.intervals.length > 0 && input.serviceIds.length === 0) {
      problem(response, 'VALIDATION_FAILED', {
        errors: [{ field: 'serviceIds', code: 'REQUIRED' }],
      });
      return;
    }
    schedule.week = {
      slotMinutes: input.slotMinutes,
      intervals: input.intervals.toSorted(
        (a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt),
      ),
      serviceIds: [...new Set(input.serviceIds)],
    };
  } else if (request.method !== 'GET') {
    problem(response, 'NOT_FOUND');
    return;
  }
  respond(response, 200, weekAnswer(providerId, schedule));
}

async function answerAbsences(
  schedule: Schedule,
  absenceId: string | undefined,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === 'GET' && absenceId === undefined) {
    respond(response, 200, { ...DISPLAY, absences: schedule.absences });
    return;
  }
  if (request.method === 'POST' && absenceId === undefined) {
    const input = await bodyOf<AbsenceInputDto>(request);
    if (input.endDate < input.startDate) {
      problem(response, 'VALIDATION_FAILED', { errors: [{ field: 'endDate', code: 'TOO_SMALL' }] });
      return;
    }
    const timed = input.startTime !== undefined && input.endTime !== undefined;
    const startsAt = instantOf(input.startDate, timed ? (input.startTime ?? '00:00') : '00:00');
    const endsAt = timed
      ? instantOf(input.startDate, input.endTime ?? '24:00')
      : instantOf(input.endDate, '00:00') + DAY_MS;
    const absence: AbsenceDto = {
      id: randomUUID(),
      startsAt: iso(startsAt),
      endsAt: iso(endsAt),
      reason: input.reason,
      allDay: !timed,
    };
    schedule.absences = [...schedule.absences, absence].toSorted((a, b) =>
      a.startsAt.localeCompare(b.startsAt),
    );
    respond(response, 201, { ...absence, bookedInside: 0 });
    return;
  }
  const kept = schedule.absences.filter(({ id }) => id !== absenceId);
  if (request.method !== 'DELETE' || kept.length === schedule.absences.length) {
    problem(response, 'NOT_FOUND');
    return;
  }
  schedule.absences = kept;
  done(response);
}

async function answerSlot(
  owner: string,
  slotId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'PATCH') {
    problem(response, 'NOT_FOUND');
    return;
  }
  const { status } = await bodyOf<{ status: 'OPEN' | 'BLOCKED' }>(request);
  const changed = changeSlot(owner, slotId, status);
  if (changed === 'NOT_FOUND' || changed === 'SLOT_HAS_APPOINTMENT') problem(response, changed);
  else respond(response, 200, changed);
}

/** Takes the requests of the doctors' schedules, and answers whether it did. */
export function handleSchedule(
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
  access: () => DeskAccess,
): boolean {
  const match = PATH.exec(pathname);
  if (match === null) return false;
  const [, providerId, resource, absenceId, slot] = match;
  const who = access();
  if ('refusal' in who) {
    problem(response, who.refusal);
    return true;
  }
  if (slot === 'generate') {
    if (request.method !== 'POST') problem(response, 'NOT_FOUND');
    else if (who.role === 'DOCTOR') problem(response, 'FORBIDDEN');
    else respond(response, 201, { created: 12, removed: 0 });
    return true;
  }
  if (slot !== undefined) {
    void answerSlot(who.email, slot, request, response);
    return true;
  }
  // A doctor plans only itself: another doctor is not there for it.
  const allowed =
    providerId !== undefined &&
    DOCTORS.has(providerId) &&
    (who.role !== 'DOCTOR' || who.providerId === providerId);
  if (!allowed) {
    problem(response, 'NOT_FOUND');
    return true;
  }
  const schedule = scheduleOf(who.email, providerId);
  if (resource === 'working-hours' && absenceId === undefined) {
    void answerWeek(schedule, providerId, request, response);
  } else void answerAbsences(schedule, absenceId, request, response);
  return true;
}

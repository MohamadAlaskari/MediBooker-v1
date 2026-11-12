/**
 * Booking for a patient (M05, W7) as the API answers it, over the stub's day of `desk-stub.ts`: the
 * team's free days and times, a booking that joins the day and the lists, and a patient without an
 * account who joins the search. The rules themselves are the API's, which its own tests prove.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  DeskBookingDto,
  DeskWeekDto,
  DeskWeekSlotDto,
  DeskNewPatientDto,
  DeskPatientRowDto,
  AvailabilityDto,
  FreeTimesDto,
  ScheduleSlotDto,
} from '@medibooker/api-client';
import { bodyOf, type FieldProblem, problem, respond } from './answers.ts';
import { patientsOf } from './desk-lists-stub.ts';
import {
  addedPatientsOf,
  type Appointment,
  type DeskAccess,
  dayOf,
  NOW,
  PROVIDER_ID,
  rowOf,
  SERVICES,
  SETTINGS,
  TODAY,
} from './desk-stub.ts';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const RIYADH_OFFSET_MS = 3 * 60 * MINUTE_MS;
const AVAILABILITY_DAYS = 42;
/** The stub's free starts: after its clock today (12:00 to 13:00 in Riyadh), and tomorrow morning. */
const STARTS = [
  '2026-11-08T09:00:00Z',
  '2026-11-08T09:30:00Z',
  '2026-11-08T10:00:00Z',
  '2026-11-09T05:00:00Z',
  '2026-11-09T05:30:00Z',
];

function plusDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function dayInRiyadh(instant: string): string {
  return new Date(Date.parse(instant) + RIYADH_OFFSET_MS).toISOString().slice(0, 10);
}

/** The starts nobody has booked: a booking takes its start away, as the API's slot does. */
/** A time's id, as the API gives one: the same time keeps its id. */
export function slotIdOf(startsAt: string): string {
  const minutes = Math.floor(Date.parse(startsAt) / MINUTE_MS);
  return `80000000-0000-4000-8000-${minutes.toString(16).padStart(12, '0')}`;
}

/** The times each staff account blocked (M04), so that tests in parallel do not meet. */
const blocked = new Map<string, Set<string>>();

function blockedOf(owner: string): Set<string> {
  const known = blocked.get(owner);
  if (known !== undefined) return known;
  const fresh = new Set<string>();
  blocked.set(owner, fresh);
  return fresh;
}

function freeStartsOf(owner: string): string[] {
  const taken = new Set(
    [...dayOf(owner).values()]
      .filter(({ status }) => status !== 'CANCELLED')
      .map(({ startsAt }) => startsAt),
  );
  const off = blockedOf(owner);
  return STARTS.filter((startsAt) => !taken.has(startsAt) && !off.has(slotIdOf(startsAt)));
}

/**
 * Blocks or frees a time of the stub doctor (BR-07): a time an appointment holds is
 * SLOT_HAS_APPOINTMENT, an unknown one NOT_FOUND.
 */
export function changeSlot(
  owner: string,
  slotId: string,
  status: 'OPEN' | 'BLOCKED',
): ScheduleSlotDto | 'NOT_FOUND' | 'SLOT_HAS_APPOINTMENT' {
  const held = [...dayOf(owner).values()].some(
    (appointment) =>
      appointment.status !== 'CANCELLED' && slotIdOf(appointment.startsAt) === slotId,
  );
  if (held) return 'SLOT_HAS_APPOINTMENT';
  const startsAt = STARTS.find((start) => slotIdOf(start) === slotId);
  if (startsAt === undefined) return 'NOT_FOUND';
  if (status === 'BLOCKED') blockedOf(owner).add(slotId);
  else blockedOf(owner).delete(slotId);
  return {
    id: slotId,
    providerId: PROVIDER_ID,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 30 * MINUTE_MS).toISOString().replace('.000', ''),
    status,
  };
}

function availabilityAnswer(owner: string): AvailabilityDto {
  const free = new Set(freeStartsOf(owner).map(dayInRiyadh));
  return {
    days: Array.from({ length: AVAILABILITY_DAYS }, (_, offset) => {
      const date = plusDays(TODAY, offset);
      return { date, hasFreeTimes: free.has(date) };
    }),
  };
}

function freeTimesAnswer(owner: string, date: string): FreeTimesDto {
  return {
    date,
    times: freeStartsOf(owner)
      .filter((startsAt) => dayInRiyadh(startsAt) === date)
      .map((startsAt) => ({ startsAt })),
  };
}

/** The stub doctor's week (W2): its appointments, the times a cancel freed, and the free ones. */
function weekAnswer(owner: string, from: string): DeskWeekDto {
  const to = plusDays(from, 6);
  const inWeek = (startsAt: string): boolean => {
    const day = dayInRiyadh(startsAt);
    return day >= from && day <= to;
  };
  const held: DeskWeekSlotDto[] = [...dayOf(owner).values()].map((appointment) =>
    appointment.status === 'CANCELLED'
      ? {
          id: slotIdOf(appointment.startsAt),
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          status: 'OPEN',
          appointment: null,
          continuation: false,
        }
      : {
          id: slotIdOf(appointment.startsAt),
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          status: 'BOOKED',
          appointment: {
            id: appointment.id,
            patient: { firstName: appointment.firstName, lastName: appointment.lastName },
            serviceName: appointment.serviceName,
            status: appointment.status,
          },
          continuation: false,
        },
  );
  const off = blockedOf(owner);
  const taken = new Set(
    [...dayOf(owner).values()]
      .filter(({ status }) => status !== 'CANCELLED')
      .map(({ startsAt }) => startsAt),
  );
  const free: DeskWeekSlotDto[] = STARTS.filter((startsAt) => !taken.has(startsAt)).map(
    (startsAt) => ({
      id: slotIdOf(startsAt),
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + 30 * MINUTE_MS).toISOString().replace('.000', ''),
      status: off.has(slotIdOf(startsAt)) ? 'BLOCKED' : 'OPEN',
      appointment: null,
      continuation: false,
    }),
  );
  // Training on the stub's Tuesday morning, 08:00 to 11:00 in Riyadh.
  const absences =
    from <= '2026-11-10' && to >= '2026-11-10'
      ? [
          {
            startsAt: '2026-11-10T05:00:00Z',
            endsAt: '2026-11-10T08:00:00Z',
            reason: 'TRAINING' as const,
          },
        ]
      : [];
  return {
    from,
    to,
    today: TODAY,
    now: NOW,
    providerId: PROVIDER_ID,
    slots: [...held, ...free]
      .filter(({ startsAt }) => inWeek(startsAt))
      .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt)),
    absences,
    truncated: false,
    ...SETTINGS,
  };
}

async function book(
  owner: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (typeof request.headers['idempotency-key'] !== 'string') {
    problem(response, 'VALIDATION_FAILED', {
      errors: [{ field: 'Idempotency-Key', code: 'REQUIRED' }],
    });
    return;
  }
  const input = await bodyOf<DeskBookingDto>(request);
  const patient = patientsOf(owner).find(({ id }) => id === input.patientId);
  const service = SERVICES.find(({ id }) => id === input.serviceId);
  if (patient === undefined || service === undefined) {
    problem(response, 'NOT_FOUND');
    return;
  }
  if (!freeStartsOf(owner).includes(input.startsAt)) {
    problem(response, 'SLOT_NOT_AVAILABLE');
    return;
  }
  const day = dayOf(owner);
  // BR-02 as the stub practice keeps it: two upcoming appointments, more with the team's reason.
  const upcoming = [...day.values()].filter(
    (appointment) =>
      rowOf(appointment).patient.id === patient.id &&
      appointment.status === 'BOOKED' &&
      Date.parse(appointment.startsAt) > Date.parse(NOW),
  );
  if (upcoming.length >= 2 && input.limitOverrideReason === undefined) {
    problem(response, 'BOOKING_LIMIT_REACHED', { params: { maxFutureAppointments: 2 } });
    return;
  }
  const appointment: Appointment = {
    id: `40000000-0000-4000-8000-0000000001${String(day.size).padStart(2, '0')}`,
    date: input.startsAt.slice(0, 10),
    startsAt: input.startsAt,
    endsAt: new Date(Date.parse(input.startsAt) + service.durationMinutes * MINUTE_MS)
      .toISOString()
      .replace('.000', ''),
    firstName: patient.firstName,
    lastName: patient.lastName,
    insuranceType: patient.insuranceType,
    serviceName: service.name,
    durationMinutes: service.durationMinutes,
    providerName: 'Dr. Lina Example',
    bookedOnline: false,
    patientNote: null,
    patientId: patient.id,
    status: 'BOOKED',
    checkedInAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
  };
  day.set(appointment.id, appointment);
  respond(response, 201, rowOf(appointment));
}

const REQUIRED = ['firstName', 'lastName', 'dateOfBirth', 'insuranceType'] as const;

async function addPatient(
  owner: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const input = await bodyOf<DeskNewPatientDto>(request);
  // The stub practice asks a provider and a number of a public insurance only, as the catalogue says.
  const isPublic = input.insuranceType === 'PUBLIC';
  const errors: FieldProblem[] = [
    ...REQUIRED.filter((field) => (input[field] ?? '') === '').map((field): FieldProblem => ({
      field,
      code: 'REQUIRED',
    })),
    ...(isPublic && input.insuranceProvider === undefined
      ? [{ field: 'insuranceProvider', code: 'REQUIRED' } as const]
      : []),
    ...(isPublic && input.insuranceNumber === undefined
      ? [{ field: 'insuranceNumber', code: 'REQUIRED' } as const]
      : []),
  ];
  if (
    errors.length > 0 ||
    input.firstName === undefined ||
    input.lastName === undefined ||
    input.dateOfBirth === undefined ||
    input.insuranceType === undefined
  ) {
    problem(response, 'VALIDATION_FAILED', { errors });
    return;
  }
  // The API's check of the same person twice, by name and date of birth (W7).
  const name = `${input.firstName} ${input.lastName}`.toLowerCase();
  const same = patientsOf(owner).some(
    (known) =>
      `${known.firstName} ${known.lastName}`.toLowerCase() === name &&
      known.dateOfBirth === input.dateOfBirth,
  );
  if (same && input.confirmDuplicate !== true) {
    problem(response, 'PATIENT_MAY_EXIST');
    return;
  }
  const added = addedPatientsOf(owner);
  const patient: DeskPatientRowDto = {
    id: `50000000-0000-4000-8000-0000000003${String(added.length).padStart(2, '0')}`,
    firstName: input.firstName,
    lastName: input.lastName,
    insuranceType: input.insuranceType,
    dateOfBirth: input.dateOfBirth,
    age: Number(TODAY.slice(0, 4)) - Number(input.dateOfBirth.slice(0, 4)),
    phone: input.phone ?? null,
    insuranceProvider: input.insuranceProvider ?? null,
    hasAccount: false,
    lastVisitAt: null,
    nextAppointmentAt: null,
  };
  added.push(patient);
  respond(response, 201, patient);
}

const DESK = String.raw`^\/api\/v1\/practices\/[^/]+\/desk`;
const ROUTES = [
  ['availability', new RegExp(`${DESK}\\/availability$`)],
  ['free-times', new RegExp(`${DESK}\\/free-times$`)],
  ['book', new RegExp(`${DESK}\\/appointments$`)],
  ['add', new RegExp(`${DESK}\\/patients$`)],
  ['week', new RegExp(`${DESK}\\/week$`)],
] as const;

/** Takes the requests of booking for a patient, and answers whether it did. */
export function handleDeskBooking(
  pathname: string,
  searchParams: URLSearchParams,
  request: IncomingMessage,
  response: ServerResponse,
  access: () => DeskAccess,
): boolean {
  const route = ROUTES.find(([, path]) => path.test(pathname))?.[0];
  if (route === undefined) return false;
  const who = access();
  if ('refusal' in who) {
    problem(response, who.refusal);
    return true;
  }
  const reads = route === 'availability' || route === 'free-times' || route === 'week';
  if (request.method !== (reads ? 'GET' : 'POST')) {
    problem(response, 'NOT_FOUND');
    return true;
  }
  if (route === 'availability') respond(response, 200, availabilityAnswer(who.email));
  else if (route === 'week') {
    respond(response, 200, weekAnswer(who.email, searchParams.get('from') ?? TODAY));
  } else if (route === 'free-times') {
    respond(response, 200, freeTimesAnswer(who.email, searchParams.get('date') ?? TODAY));
  } else if (route === 'book') void book(who.email, request, response);
  else void addPatient(who.email, request, response);
  return true;
}

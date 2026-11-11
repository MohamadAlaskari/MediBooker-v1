/**
 * The practice's desk (M05) as the API answers it, in memory, one day of synthetic appointments per
 * staff account, so that tests in parallel do not meet. The stub's clock stands at 10:00 in Riyadh on
 * its today; the rules are the API's (BR-04, BR-11), which `desk.rules.spec.ts` proves for real.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  DeskAppointmentDto,
  DeskAppointmentRowDto,
  DeskDayDto,
  DeskPatientRowDto,
  ErrorCode,
} from '@medibooker/api-client';
import { bodyOf, problem, respond } from './answers.ts';

export const TODAY = '2026-11-08';
const TOMORROW = '2026-11-09';
/** 10:00 on the stub's today in Riyadh. */
export const NOW = '2026-11-08T07:00:00Z';
export const SETTINGS = {
  timeZone: 'Asia/Riyadh',
  numberingSystem: 'latn',
  hourCycle: 'h23',
} as const;
const MAX_REASON_LENGTH = 500;

type Status = DeskAppointmentRowDto['status'];
type Action = 'CHECK_IN' | 'COMPLETE' | 'NO_SHOW' | 'CANCEL';

export interface Appointment {
  readonly id: string;
  readonly date: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly insuranceType: DeskAppointmentRowDto['patient']['insuranceType'];
  readonly serviceName: Readonly<Record<string, string>>;
  readonly durationMinutes: number;
  readonly providerName: string;
  readonly bookedOnline: boolean;
  readonly patientNote: string | null;
  /** A patient of their own, for a booking by the team (W7); left out, one per appointment. */
  readonly patientId?: string;
  status: Status;
  checkedInAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export const CHECK_UP = { en: 'Check-up', ar: 'فحص عام' };
export const BLOOD_TEST = { en: 'Blood test', ar: 'تحليل دم' };
export const CHECK_UP_ID = '60000000-0000-4000-8000-000000000001';
export const BLOOD_TEST_ID = '60000000-0000-4000-8000-000000000002';
export const PROVIDER_ID = '70000000-0000-4000-8000-000000000001';
export const SERVICES = [
  { id: CHECK_UP_ID, name: CHECK_UP, durationMinutes: 30, active: true },
  { id: BLOOD_TEST_ID, name: BLOOD_TEST, durationMinutes: 15, active: true },
];

/** A fresh day per account: what one test changes, another does not see. */
function seed(): Map<string, Appointment> {
  const appointment = (
    index: number,
    startsAt: string,
    fields: Partial<Appointment> & Pick<Appointment, 'firstName' | 'lastName'>,
  ): Appointment => ({
    id: `40000000-0000-4000-8000-00000000000${String(index)}`,
    date: startsAt.slice(0, 10),
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString().replace('.000', ''),
    insuranceType: 'PUBLIC',
    serviceName: CHECK_UP,
    durationMinutes: 30,
    providerName: 'Dr. Lina Example',
    bookedOnline: true,
    patientNote: null,
    status: 'BOOKED',
    checkedInAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    ...fields,
  });
  const day = [
    appointment(1, '2026-11-08T05:00:00Z', {
      firstName: 'Sami',
      lastName: 'Beispiel',
      status: 'COMPLETED',
      checkedInAt: '2026-11-08T04:55:00Z',
      completedAt: '2026-11-08T05:20:00Z',
    }),
    appointment(2, '2026-11-08T05:30:00Z', {
      firstName: 'Mona',
      lastName: 'Example',
      insuranceType: 'PRIVATE',
      serviceName: BLOOD_TEST,
      durationMinutes: 15,
      status: 'CHECKED_IN',
      checkedInAt: '2026-11-08T05:25:00Z',
    }),
    appointment(3, '2026-11-08T06:00:00Z', {
      firstName: 'سارة',
      lastName: 'مثال',
      insuranceType: 'SELF_PAY',
      patientNote: 'Synthetic note: I may come ten minutes late.',
    }),
    appointment(4, '2026-11-08T08:00:00Z', {
      firstName: 'Omar',
      lastName: 'Beispiel',
      bookedOnline: false,
    }),
    appointment(5, '2026-11-08T08:30:00Z', {
      firstName: 'Yusuf',
      lastName: 'Example',
      status: 'CANCELLED',
      cancelledAt: '2026-11-07T12:00:00Z',
      cancelReason: 'Synthetic reason: the doctor is away.',
    }),
    appointment(6, '2026-11-09T06:30:00Z', { firstName: 'Huda', lastName: 'Example' }),
  ];
  return new Map(day.map((entry) => [entry.id, entry]));
}

const days = new Map<string, Map<string, Appointment>>();
const added = new Map<string, DeskPatientRowDto[]>();

/** The patients the team added without an account (W7), per account like the day. */
export function addedPatientsOf(owner: string): DeskPatientRowDto[] {
  const existing = added.get(owner);
  if (existing !== undefined) return existing;
  const fresh: DeskPatientRowDto[] = [];
  added.set(owner, fresh);
  return fresh;
}

export function dayOf(owner: string): Map<string, Appointment> {
  const existing = days.get(owner);
  if (existing !== undefined) return existing;
  const fresh = seed();
  days.set(owner, fresh);
  return fresh;
}

/** The API's matrix of BR-04 and BR-11, at the stub's clock. */
function actionsOf({ status, date, startsAt }: Appointment): Action[] {
  const today = date === TODAY;
  const started = Date.parse(NOW) >= Date.parse(startsAt);
  if (status === 'CHECKED_IN') return today ? ['COMPLETE'] : [];
  if (status !== 'BOOKED') return [];
  return [
    ...(today ? (['CHECK_IN'] as const) : []),
    ...(today && started ? (['NO_SHOW'] as const) : []),
    'CANCEL',
  ];
}

export function rowOf(appointment: Appointment): DeskAppointmentRowDto {
  const { date } = appointment;
  return {
    id: appointment.id,
    patient: {
      id: appointment.patientId ?? appointment.id.replace('40000000', '50000000'),
      firstName: appointment.firstName,
      lastName: appointment.lastName,
      insuranceType: appointment.insuranceType,
    },
    serviceId: appointment.serviceName === BLOOD_TEST ? BLOOD_TEST_ID : CHECK_UP_ID,
    serviceName: appointment.serviceName,
    durationMinutes: appointment.durationMinutes,
    providerId: PROVIDER_ID,
    providerName: appointment.providerName,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    status: appointment.status,
    bookedOnline: appointment.bookedOnline,
    checkedInAt: appointment.checkedInAt,
    completedAt: appointment.completedAt,
    cancelledAt: appointment.cancelledAt,
    cancelledByPractice: appointment.status === 'CANCELLED' && appointment.cancelReason !== null,
    day: date < TODAY ? 'PAST' : date === TODAY ? 'TODAY' : 'FUTURE',
    started: Date.parse(NOW) >= Date.parse(appointment.startsAt),
    actions: actionsOf(appointment),
  };
}

export function detailsOf(appointment: Appointment): DeskAppointmentDto {
  const row = rowOf(appointment);
  return {
    ...row,
    patient: {
      ...row.patient,
      dateOfBirth: '1990-04-12',
      age: 36,
      insuranceProvider: appointment.insuranceType === 'SELF_PAY' ? null : 'Synthetic Insurance',
      phone: '+966 50 000 0000',
      email: 'patient@example.test',
    },
    bookedAt: '2026-11-01T15:00:00Z',
    patientNote: appointment.patientNote,
    cancelReason: appointment.cancelReason,
    ...SETTINGS,
  };
}

function dayAnswer(owner: string, date: string): DeskDayDto {
  const items = [...dayOf(owner).values()]
    .filter((appointment) => appointment.date === date)
    .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt));
  const count = (status: Status): number =>
    items.filter((appointment) => appointment.status === status).length;
  const free: Readonly<Record<string, { openTimes: number; nextOpenAt: string | null }>> = {
    [TODAY]: { openTimes: 3, nextOpenAt: '2026-11-08T09:00:00Z' },
    [TOMORROW]: { openTimes: 4, nextOpenAt: '2026-11-09T05:00:00Z' },
  };
  return {
    date,
    today: TODAY,
    now: NOW,
    ...SETTINGS,
    counts: {
      booked: count('BOOKED'),
      checkedIn: count('CHECKED_IN'),
      completed: count('COMPLETED'),
      noShow: count('NO_SHOW'),
      cancelled: count('CANCELLED'),
    },
    ...(free[date] ?? { openTimes: 0, nextOpenAt: null }),
    items: items.map(rowOf),
    truncated: false,
  };
}

const TARGET: Readonly<Record<Action, Status>> = {
  CHECK_IN: 'CHECKED_IN',
  COMPLETE: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
  CANCEL: 'CANCELLED',
};

const ACTION_OF: Readonly<Record<string, Action>> = {
  'check-in': 'CHECK_IN',
  complete: 'COMPLETE',
  'no-show': 'NO_SHOW',
  cancel: 'CANCEL',
};

async function change(
  appointment: Appointment,
  action: Action,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let reason: string | undefined;
  if (action === 'CANCEL') {
    const { cancelReason } = await bodyOf<{ cancelReason?: unknown }>(request);
    if (
      typeof cancelReason !== 'string' ||
      cancelReason.trim() === '' ||
      cancelReason.length > MAX_REASON_LENGTH
    ) {
      problem(response, 'VALIDATION_FAILED', {
        errors: [{ field: 'cancelReason', code: 'REQUIRED' }],
      });
      return;
    }
    reason = cancelReason;
  }
  const to = TARGET[action];
  // As the API: a cancel the patient made is not the practice's, and is never answered as one.
  if (
    action === 'CANCEL' &&
    appointment.status === 'CANCELLED' &&
    appointment.cancelReason === null
  ) {
    problem(response, 'INVALID_STATUS_TRANSITION');
    return;
  }
  if (appointment.status !== to) {
    if (!actionsOf(appointment).includes(action)) {
      problem(response, 'INVALID_STATUS_TRANSITION');
      return;
    }
    appointment.status = to;
    if (action === 'CHECK_IN') appointment.checkedInAt = NOW;
    if (action === 'COMPLETE') appointment.completedAt = NOW;
    if (action === 'CANCEL') {
      appointment.cancelledAt = NOW;
      appointment.cancelReason = reason ?? null;
    }
  }
  respond(response, 200, rowOf(appointment));
}

const DAY_PATH = /^\/api\/v1\/practices\/[^/]+\/desk\/day$/;
const APPOINTMENT_PATH =
  /^\/api\/v1\/practices\/[^/]+\/desk\/appointments\/([^/]+)(?:\/(check-in|complete|no-show|cancel))?$/;

/** Who may reach the desk, as the API's practice context answers: an email, or why not. */
export type DeskAccess = { readonly email: string } | { readonly refusal: ErrorCode };

/** Takes the requests of the desk, and answers whether it did. */
export function handleDesk(
  pathname: string,
  searchParams: URLSearchParams,
  request: IncomingMessage,
  response: ServerResponse,
  access: () => DeskAccess,
): boolean {
  const isDay = DAY_PATH.test(pathname);
  const match = APPOINTMENT_PATH.exec(pathname);
  if (!isDay && match === null) return false;
  const who = access();
  if ('refusal' in who) {
    problem(response, who.refusal);
    return true;
  }
  if (isDay) {
    if (request.method !== 'GET') problem(response, 'NOT_FOUND');
    else respond(response, 200, dayAnswer(who.email, searchParams.get('date') ?? TODAY));
    return true;
  }
  const [, id = '', route] = match ?? [];
  const appointment = dayOf(who.email).get(id);
  if (appointment === undefined) {
    problem(response, 'NOT_FOUND');
  } else if (route === undefined) {
    if (request.method === 'GET') respond(response, 200, detailsOf(appointment));
    else problem(response, 'NOT_FOUND');
  } else if (request.method === 'POST') {
    void change(appointment, ACTION_OF[route] ?? 'CANCEL', request, response);
  } else {
    problem(response, 'NOT_FOUND');
  }
  return true;
}

/**
 * Patients and appointments as the API keeps them, in memory, route by route: the same methods and
 * status codes, the same checks in the same order, and `contract.ts` holds every answer against the
 * generated schemas. Only one thing is not as in production: what a practice decides, such as what it
 * asks for or whose profile is public, changes for one person alone, because the tests run side by
 * side. The real rules are tested against the API; this lets the pages meet every case on demand.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  AppointmentDto,
  MyPracticeDto,
  PatientDto,
  PublicPracticeDto,
  UnavailablePracticeDto,
} from '@medibooker/api-client';
import {
  bodyOf,
  done,
  numberEndOf,
  problem,
  respond,
  type FieldProblem,
  type Refusal,
} from './answers.ts';
import { hasCsrfHeader, isVerified, profileOf } from './auth-stub.ts';
import {
  DOCTOR_ID,
  marketOf,
  practiceById,
  PRACTICE_ID,
  SERVICE_ID,
  SERVICE_NAMES,
  startsOn,
} from './practices.ts';

/** The moment the stub lives in, on its today of 2026-11-08. */
const NOW = '2026-11-08T05:00:00Z';
const TODAY = '2026-11-08';
/** A visit that has been, for a booked row that nobody has given another status yet (M05). */
const PAST_VISIT = '2026-11-01T06:00:00Z';
/** What a booking gets when no doctor it could name is free: the API picks one without a public profile. */
const UNNAMED_DOCTOR = '20000000-0000-4000-8000-000000000099';
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * HOUR_MS;
const MIN_LEAD_MINUTES = 60;
const MAX_HORIZON_DAYS = 60;
const MAX_FUTURE_APPOINTMENTS = 5;
const JOINS_PER_DAY = 5;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_NOTE_LENGTH = 500;
const SECONDS_UNTIL_A_JOIN_PLACE = '3600';
const SECONDS_A_THROTTLE_WAITS = '60';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `INSTANT` and `NOTE_TEXT` of appointments.dto.ts. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const NOTE_TEXT =
  /^(?=[\s\S]*[^\s\u{200C}\u{200D}])(?:[^\p{C}\p{Zl}\p{Zp}]|[\n\u{200C}\u{200D}])+$/u;
/** `NUMBER_FORMATS` of insurance.rules.ts. */
const GERMAN_PUBLIC_NUMBER = /^[A-Z][0-9]{9}$/;
const ANY_MARKET_NUMBER = /^[A-Z0-9]{6,40}$/;

type InsuranceType = PatientDto['insuranceType'];

interface Appointment {
  readonly id: string;
  readonly practiceId: string;
  readonly patientId: string;
  readonly serviceId: string;
  readonly providerId: string;
  readonly startsAt: string;
  patientNote: string | undefined;
  status: AppointmentDto['status'];
  movedTo?: string;
}

interface Person {
  /** One profile per practice (B01), by the practice's id. */
  readonly patients: Map<string, PatientDto>;
  /** Where the person only works: a row in the list of practices, and no patient. */
  readonly staffAt: Set<string>;
  readonly appointments: Appointment[];
  /** What an Idempotency-Key answered, per practice. */
  readonly keys: Map<string, { readonly request: string; readonly appointmentId: string }>;
  /** Times someone else took in the meantime. */
  readonly takenTimes: Set<string>;
  missing: readonly UnavailablePracticeDto[];
  needsConsent: boolean;
  /** How many more questions for the upcoming list are limited, and what the answer asks to wait. */
  listLimited: { times: number; readonly retryAfterSeconds: string };
  /** How many more questions for the list of practices are limited. */
  practicesLimited: number;
  /** The next booking goes through, and its answer never arrives. */
  losesNextAnswer: boolean;
  noteRefused: boolean;
  // What practices decide, for this person alone.
  asksEverything: boolean;
  doctorHidden: boolean;
  serviceOffline: boolean;
  maxHorizonDays: number;
  maxFutureAppointments: number;
  joinsPerDay: number;
}

const people = new Map<string, Person>();

function personOf(owner: string): Person {
  const known = people.get(owner);
  if (known !== undefined) return known;
  const person: Person = {
    patients: new Map(),
    staffAt: new Set(),
    appointments: [],
    keys: new Map(),
    takenTimes: new Set(),
    missing: [],
    needsConsent: false,
    listLimited: { times: 0, retryAfterSeconds: '1' },
    practicesLimited: 0,
    losesNextAnswer: false,
    noteRefused: false,
    asksEverything: false,
    doctorHidden: false,
    serviceOffline: false,
    maxHorizonDays: MAX_HORIZON_DAYS,
    maxFutureAppointments: MAX_FUTURE_APPOINTMENTS,
    joinsPerDay: JOINS_PER_DAY,
  };
  people.set(owner, person);
  return person;
}

/** A practice as what it decided for this person has made it. */
function asSeenBy(person: Person, practice: PublicPracticeDto): PublicPracticeDto {
  const insured: PublicPracticeDto['insuranceNumberTypes'] = ['PUBLIC', 'PRIVATE'];
  return {
    ...practice,
    ...(person.asksEverything
      ? { insuranceProviderTypes: insured, insuranceNumberTypes: insured }
      : {}),
    ...(person.doctorHidden ? { team: [] } : {}),
  };
}

function appointmentsAt(person: Person, practiceId: string): readonly Appointment[] {
  return person.appointments.filter((appointment) => appointment.practiceId === practiceId);
}

function practiceOf(person: Person, id: string): PublicPracticeDto {
  const answer = practiceById(id);
  if (answer === undefined) throw new Error(`The stub has no practice ${id}`);
  return asSeenBy(person, answer('en'));
}

function durationOf(practice: PublicPracticeDto, serviceId: string): number {
  const service = practice.services.find(({ id }) => id === serviceId);
  return (service?.durationMinutes ?? 0) * MINUTE_MS;
}

function hasStarted({ startsAt }: Appointment): boolean {
  return Date.parse(NOW) >= Date.parse(startsAt);
}

function isUpcoming(appointment: Appointment): boolean {
  return appointment.status === 'BOOKED' && !hasStarted(appointment);
}

/** BR-04: BOOKED, and not past the practice's deadline. */
function isChangeable({ startsAt }: Appointment, practice: PublicPracticeDto): boolean {
  const until = Date.parse(startsAt) - practice.cancellationDeadlineHours * HOUR_MS;
  return Date.parse(NOW) <= until;
}

function viewOf(person: Person, appointment: Appointment): AppointmentDto {
  const practice = practiceOf(person, appointment.practiceId);
  const start = Date.parse(appointment.startsAt);
  // BR-24, at the moment of reading: whichever way the appointment came about.
  const doctor = practice.team.find(({ id }) => id === appointment.providerId);
  return {
    id: appointment.id,
    practiceId: appointment.practiceId,
    patientId: appointment.patientId,
    serviceId: appointment.serviceId,
    serviceName: SERVICE_NAMES[appointment.serviceId] ?? {},
    providerId: doctor?.id ?? null,
    providerName:
      doctor === undefined
        ? null
        : [doctor.title, doctor.firstName, doctor.lastName]
            .filter((part) => part !== null)
            .join(' '),
    startsAt: appointment.startsAt,
    endsAt: new Date(start + durationOf(practice, appointment.serviceId)).toISOString(),
    timeZone: practice.timeZone,
    numberingSystem: practice.numberingSystem,
    hourCycle: practice.hourCycle,
    status: appointment.status,
    bookedAt: NOW,
    changeableUntil: new Date(start - practice.cancellationDeadlineHours * HOUR_MS).toISOString(),
    changeable: appointment.status === 'BOOKED' && isChangeable(appointment, practice),
    started: hasStarted(appointment),
  };
}

/** A person's details as sent: a null removes a phone, and is no value for anything else. */
interface Details {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly dateOfBirth?: string;
  readonly phone?: string | null;
  readonly insuranceType?: InsuranceType;
  readonly insuranceProvider?: string;
  readonly insuranceNumber?: string;
  readonly privacyNoticeVersion?: string;
}

interface CheckedInsurance {
  readonly problems: readonly FieldProblem[];
  readonly provider: string | null;
  /** Normalised; undefined when none was given or this type keeps none. */
  readonly number: string | undefined;
}

function isValidNumber(market: string, type: InsuranceType, number: string): boolean {
  const format = market === 'DE' && type === 'PUBLIC' ? GERMAN_PUBLIC_NUMBER : ANY_MARKET_NUMBER;
  return format.test(number);
}

/** `checkedInsurance` of insurance.rules.ts. */
function checkedInsurance(
  practice: PublicPracticeDto,
  {
    type,
    provider,
    number,
    numberKnown,
  }: {
    readonly type: InsuranceType | undefined;
    readonly provider: string | null | undefined;
    readonly number: string | undefined;
    readonly numberKnown: boolean;
  },
): CheckedInsurance {
  const none = { provider: null, number: undefined };
  if (type === undefined) {
    return { ...none, problems: [{ field: 'insuranceType', code: 'REQUIRED' }] };
  }
  if (!practice.insuranceTypes.includes(type)) {
    return { ...none, problems: [{ field: 'insuranceType', code: 'INVALID_VALUE' }] };
  }
  if (type === 'SELF_PAY') return { ...none, problems: [] };

  const problems: FieldProblem[] = [];
  const hasProvider = provider !== undefined && provider !== null && provider !== '';
  if (practice.insuranceProviderTypes.includes(type) && !hasProvider) {
    problems.push({ field: 'insuranceProvider', code: 'REQUIRED' });
  }
  const normalized = number?.replaceAll(/[\s./-]/gu, '').toUpperCase();
  if (normalized !== undefined) {
    if (!isValidNumber(marketOf(practice.id), type, normalized)) {
      problems.push({ field: 'insuranceNumber', code: 'INVALID_VALUE' });
    }
  } else if (practice.insuranceNumberTypes.includes(type) && !numberKnown) {
    problems.push({ field: 'insuranceNumber', code: 'REQUIRED' });
  }
  return { problems, provider: hasProvider ? provider : null, number: normalized };
}

/** BR-09: the profile meets what the practice asks today, which can have changed since the join. */
function isProfileComplete(practice: PublicPracticeDto, patient: PatientDto): boolean {
  const { problems } = checkedInsurance(practice, {
    type: patient.insuranceType,
    provider: patient.insuranceProvider,
    number: undefined,
    numberKnown: patient.insuranceNumberEnd !== null,
  });
  return problems.length === 0;
}

function birthDateProblems(value: string | undefined): readonly FieldProblem[] {
  if (value === undefined) return [{ field: 'dateOfBirth', code: 'REQUIRED' }];
  const plausible = !Number.isNaN(Date.parse(value)) && value < TODAY;
  return plausible ? [] : [{ field: 'dateOfBirth', code: 'INVALID_VALUE' }];
}

/** A request of one route, past its guards. */
interface Call {
  readonly owner: string;
  readonly person: Person;
  readonly practice: PublicPracticeDto;
  /** The id after the practice's in the path. */
  readonly param: string | undefined;
  readonly searchParams: URLSearchParams;
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
}

/** The guards found the person's profile here before a route that needs one runs. */
function patientOf({ person, practice }: Call): PatientDto {
  const patient = person.patients.get(practice.id);
  if (patient === undefined) throw new Error('A route for patients ran without a patient');
  return patient;
}

async function join(call: Call): Promise<void> {
  const { owner, person, practice, request, response } = call;
  const input = await bodyOf<Details>(request);
  if (person.patients.has(practice.id)) {
    problem(response, 'ALREADY_JOINED');
    return;
  }
  const profile = profileOf(owner);
  const type = input.insuranceType ?? profile?.insuranceType;
  const sameType = profile !== undefined && type === profile.insuranceType;
  // Only what this practice asks for: the rest of the account's details stays with the account.
  const asksNumber = type !== undefined && practice.insuranceNumberTypes.includes(type);
  const asksProvider = type !== undefined && practice.insuranceProviderTypes.includes(type);
  const copiedEnd =
    input.insuranceNumber === undefined && sameType && asksNumber
      ? profile.insuranceNumberEnd
      : null;
  const insurance = checkedInsurance(practice, {
    type,
    provider:
      input.insuranceProvider ?? (sameType && asksProvider ? profile.insuranceProvider : null),
    number: input.insuranceNumber,
    numberKnown: copiedEnd !== null,
  });
  const firstName = input.firstName ?? profile?.firstName;
  const lastName = input.lastName ?? profile?.lastName;
  const dateOfBirth = input.dateOfBirth ?? profile?.dateOfBirth;
  const problems: readonly FieldProblem[] = [
    ...(firstName === undefined ? [{ field: 'firstName', code: 'REQUIRED' } as const] : []),
    ...(lastName === undefined ? [{ field: 'lastName', code: 'REQUIRED' } as const] : []),
    ...birthDateProblems(dateOfBirth),
    ...insurance.problems,
    ...(person.needsConsent && input.privacyNoticeVersion === undefined
      ? [{ field: 'privacyNoticeVersion', code: 'REQUIRED' } as const]
      : []),
  ];
  if (
    problems.length > 0 ||
    firstName === undefined ||
    lastName === undefined ||
    dateOfBirth === undefined ||
    type === undefined
  ) {
    problem(response, 'VALIDATION_FAILED', { errors: problems });
    return;
  }
  if (person.patients.size >= person.joinsPerDay) {
    problem(response, 'JOIN_LIMIT_REACHED', {}, { 'Retry-After': SECONDS_UNTIL_A_JOIN_PLACE });
    return;
  }
  const patient: PatientDto = {
    id: randomUUID(),
    firstName,
    lastName,
    dateOfBirth,
    phone: input.phone === undefined ? (profile?.phone ?? null) : input.phone,
    insuranceType: type,
    insuranceProvider: insurance.provider,
    insuranceNumberEnd: insurance.number === undefined ? copiedEnd : numberEndOf(insurance.number),
  };
  person.needsConsent = false;
  person.patients.set(practice.id, patient);
  respond(response, 201, patient);
}

function listPatients(call: Call): void {
  respond(call.response, 200, { items: [patientOf(call)] });
}

function readPatient(call: Call): void {
  const patient = patientOf(call);
  if (call.param?.toLowerCase() === patient.id) respond(call.response, 200, patient);
  else problem(call.response, 'NOT_FOUND');
}

/** What is left out stays. Insurance is checked only when it changes: the rules can have moved. */
async function updatePatient(call: Call): Promise<void> {
  const { person, practice, param, request, response } = call;
  const patient = patientOf(call);
  if (param?.toLowerCase() !== patient.id) {
    problem(response, 'NOT_FOUND');
    return;
  }
  const input = await bodyOf<Details>(request);
  const changesInsurance =
    input.insuranceType !== undefined ||
    input.insuranceProvider !== undefined ||
    input.insuranceNumber !== undefined;
  const type = input.insuranceType ?? patient.insuranceType;
  const sameType = type === patient.insuranceType;
  const insurance = changesInsurance
    ? checkedInsurance(practice, {
        type,
        provider: input.insuranceProvider ?? (sameType ? patient.insuranceProvider : null),
        number: input.insuranceNumber,
        numberKnown: sameType && patient.insuranceNumberEnd !== null,
      })
    : undefined;
  const problems = [
    ...(input.dateOfBirth === undefined ? [] : birthDateProblems(input.dateOfBirth)),
    ...(insurance?.problems ?? []),
  ];
  if (problems.length > 0) {
    problem(response, 'VALIDATION_FAILED', { errors: problems });
    return;
  }
  const updated: PatientDto = {
    ...patient,
    ...(input.firstName === undefined ? {} : { firstName: input.firstName }),
    ...(input.lastName === undefined ? {} : { lastName: input.lastName }),
    ...(input.dateOfBirth === undefined ? {} : { dateOfBirth: input.dateOfBirth }),
    ...(input.phone === undefined ? {} : { phone: input.phone }),
    ...(insurance === undefined
      ? {}
      : { insuranceType: type, insuranceProvider: insurance.provider }),
    // A type that keeps none drops what was sent; another type takes none of the old one along.
    insuranceNumberEnd:
      insurance?.number === undefined
        ? sameType
          ? patient.insuranceNumberEnd
          : null
        : numberEndOf(insurance.number),
  };
  person.patients.set(practice.id, updated);
  respond(response, 200, updated);
}

/** A time to book, as the rules read it. */
interface Wanted {
  readonly serviceId: string;
  readonly startsAt: string;
  readonly providerId: string | undefined;
}

/** BR-03, both ends included. */
function isInBookingWindow(person: Person, startsAt: string): boolean {
  const start = Date.parse(startsAt);
  const now = Date.parse(NOW);
  return (
    start >= now + MIN_LEAD_MINUTES * MINUTE_MS && start <= now + person.maxHorizonDays * DAY_MS
  );
}

/** `requireBookable`: BR-03, BR-08, and a doctor who may be asked for by name. */
function whyNotBookable(
  person: Person,
  practice: PublicPracticeDto,
  { serviceId, startsAt, providerId }: Wanted,
): Refusal | undefined {
  if (!isInBookingWindow(person, startsAt)) return { code: 'OUTSIDE_BOOKING_WINDOW' };
  const offered = practice.services.some(({ id }) => id === serviceId) && !person.serviceOffline;
  if (!offered) return { code: 'SERVICE_NOT_BOOKABLE' };
  if (providerId !== undefined && !practice.team.some(({ id }) => id === providerId)) {
    return { code: 'NOT_FOUND' };
  }
  return undefined;
}

/** What the person holds at a time keeps others from it, like a slot that someone booked. */
function isHeld(person: Person, practiceId: string, startsAt: string): boolean {
  return appointmentsAt(person, practiceId).some(
    (appointment) => appointment.startsAt === startsAt && appointment.status === 'BOOKED',
  );
}

function isFree(
  person: Person,
  practice: PublicPracticeDto,
  startsAt: string,
  providerId: string | null,
): boolean {
  const date = startsAt.slice(0, 'YYYY-MM-DD'.length);
  return (
    startsOn(practice.slug, date, providerId).includes(startsAt) &&
    isInBookingWindow(person, startsAt) &&
    !person.takenTimes.has(startsAt) &&
    !isHeld(person, practice.id, startsAt)
  );
}

/** `takeSlot`, BR-25 first: without a free slot too, the person's own appointment says it better. */
function whyNoSlot(
  person: Person,
  practice: PublicPracticeDto,
  { serviceId, startsAt, providerId }: Wanted,
  moving?: Appointment,
): Refusal | undefined {
  const free = isFree(person, practice, startsAt, providerId ?? null);
  const start = Date.parse(startsAt);
  const until = start + (free ? durationOf(practice, serviceId) : 1);
  const overlaps = appointmentsAt(person, practice.id).some((appointment) => {
    if (appointment === moving || !isUpcoming(appointment)) return false;
    const from = Date.parse(appointment.startsAt);
    return from < until && from + durationOf(practice, appointment.serviceId) > start;
  });
  if (overlaps) return { code: 'APPOINTMENT_OVERLAP' };
  return free ? undefined : { code: 'SLOT_NOT_AVAILABLE' };
}

function place(
  person: Person,
  practice: PublicPracticeDto,
  patient: PatientDto,
  { serviceId, startsAt, providerId }: Wanted,
  patientNote: string | undefined,
): Appointment {
  const appointment: Appointment = {
    id: randomUUID(),
    practiceId: practice.id,
    patientId: patient.id,
    serviceId,
    startsAt,
    // Any doctor: the API answers who it became, and names nobody without a public profile.
    providerId: providerId ?? practice.team[0]?.id ?? UNNAMED_DOCTOR,
    patientNote,
    status: 'BOOKED',
  };
  person.appointments.push(appointment);
  return appointment;
}

/** A key per attempt, in the form the contract names; undefined when it answered already. */
function keyOf({ request, response }: Call): string | undefined {
  const key = request.headers['idempotency-key'];
  if (key === undefined) {
    problem(response, 'VALIDATION_FAILED', {
      errors: [{ field: 'Idempotency-Key', code: 'REQUIRED' }],
    });
    return undefined;
  }
  if (typeof key !== 'string' || !UUID.test(key)) {
    problem(response, 'VALIDATION_FAILED', {
      errors: [{ field: 'Idempotency-Key', code: 'INVALID_VALUE' }],
    });
    return undefined;
  }
  return key.toLowerCase();
}

/**
 * `claimKey`: what the key answered before, as it is now, and whether that ended the request. Only a
 * success keeps its key: a failed attempt rolled it back, so a retry with it is judged anew.
 */
function replayed(call: Call, key: string, fingerprint: string): boolean {
  const { person, practice, response } = call;
  const stored = person.keys.get(`${practice.id}:${key}`);
  if (stored === undefined) return false;
  const first = person.appointments.find(({ id }) => id === stored.appointmentId);
  if (stored.request !== fingerprint || first === undefined) {
    problem(response, 'IDEMPOTENCY_KEY_REUSED');
    return true;
  }
  respond(response, 201, viewOf(person, first));
  return true;
}

function timeProblems({
  startsAt,
  providerId,
}: {
  readonly startsAt?: string;
  readonly providerId?: string;
}): readonly FieldProblem[] {
  return [
    ...(startsAt !== undefined && INSTANT.test(startsAt)
      ? []
      : [{ field: 'startsAt', code: 'INVALID_FORMAT' } as const]),
    ...(providerId === undefined || UUID.test(providerId)
      ? []
      : [{ field: 'providerId', code: 'INVALID_FORMAT' } as const]),
  ];
}

interface BookingValues {
  readonly serviceId?: string;
  readonly startsAt?: string;
  readonly providerId?: string;
  readonly patientNote?: string;
}

function bookingProblems(person: Person, values: BookingValues): readonly FieldProblem[] {
  const { serviceId, patientNote } = values;
  const noteIsFine =
    patientNote === undefined ||
    (!person.noteRefused && patientNote.length <= MAX_NOTE_LENGTH && NOTE_TEXT.test(patientNote));
  return [
    ...(serviceId !== undefined && UUID.test(serviceId)
      ? []
      : [{ field: 'serviceId', code: 'INVALID_FORMAT' } as const]),
    ...timeProblems(values),
    ...(noteIsFine ? [] : [{ field: 'patientNote', code: 'INVALID_FORMAT' } as const]),
  ];
}

/** What stands before a new appointment, in the order of the API's transaction. */
function whyNotPlaced(
  person: Person,
  practice: PublicPracticeDto,
  patient: PatientDto,
  wanted: Wanted,
): Refusal | undefined {
  if (!isProfileComplete(practice, patient)) return { code: 'PATIENT_PROFILE_INCOMPLETE' };
  const notBookable = whyNotBookable(person, practice, wanted);
  if (notBookable !== undefined) return notBookable;
  // BR-02 counts what has not happened yet.
  const upcoming = appointmentsAt(person, practice.id).filter(isUpcoming).length;
  if (upcoming >= person.maxFutureAppointments) {
    return {
      code: 'BOOKING_LIMIT_REACHED',
      params: { maxFutureAppointments: person.maxFutureAppointments },
    };
  }
  return whyNoSlot(person, practice, wanted);
}

async function book(call: Call): Promise<void> {
  const { person, practice, request, response } = call;
  const patient = patientOf(call);
  const values = await bodyOf<BookingValues>(request);
  const wrong = bookingProblems(person, values);
  if (wrong.length > 0) {
    problem(response, 'VALIDATION_FAILED', { errors: wrong });
    return;
  }
  const key = keyOf(call);
  if (key === undefined) return;
  const wanted: Wanted = {
    serviceId: (values.serviceId ?? '').toLowerCase(),
    startsAt: values.startsAt ?? '',
    providerId: values.providerId?.toLowerCase(),
  };
  const fingerprint = JSON.stringify([
    wanted.serviceId,
    wanted.startsAt,
    wanted.providerId ?? null,
    values.patientNote ?? null,
  ]);
  if (replayed(call, key, fingerprint)) return;

  const refusal = whyNotPlaced(person, practice, patient, wanted);
  if (refusal !== undefined) {
    problem(response, refusal.code, refusal);
    return;
  }
  const appointment = place(person, practice, patient, wanted, values.patientNote);
  person.keys.set(`${practice.id}:${key}`, {
    request: fingerprint,
    appointmentId: appointment.id,
  });
  if (person.losesNextAnswer) {
    person.losesNextAnswer = false;
    request.socket.destroy();
    return;
  }
  respond(response, 201, viewOf(person, appointment));
}

function ownRow(call: Call): Appointment | undefined {
  const { person, practice, param } = call;
  return appointmentsAt(person, practice.id).find(({ id }) => id === param?.toLowerCase());
}

function readAppointment(call: Call): void {
  const row = ownRow(call);
  if (row === undefined) problem(call.response, 'NOT_FOUND');
  else respond(call.response, 200, viewOf(call.person, row));
}

/** BR-04 for a row: `requireChangeable`. */
function whyNotChangeable(row: Appointment, practice: PublicPracticeDto): Refusal | undefined {
  if (row.status !== 'BOOKED') return { code: 'INVALID_STATUS_TRANSITION' };
  if (isChangeable(row, practice)) return undefined;
  return {
    code: 'CANCELLATION_DEADLINE_PASSED',
    params: { cancellationDeadlineHours: practice.cancellationDeadlineHours },
  };
}

/** A second cancel changes nothing and answers the same; not for a row that was moved. */
function cancel(call: Call): void {
  const { person, practice, response } = call;
  const row = ownRow(call);
  if (row === undefined) {
    problem(response, 'NOT_FOUND');
    return;
  }
  if (row.status !== 'CANCELLED' || row.movedTo !== undefined) {
    const refusal = whyNotChangeable(row, practice);
    if (refusal !== undefined) {
      problem(response, refusal.code, refusal);
      return;
    }
    row.status = 'CANCELLED';
  }
  respond(response, 200, viewOf(person, row));
}

/** BR-05: a new appointment, and the old one cancelled. The note moves with it. */
async function reschedule(call: Call): Promise<void> {
  const { person, practice, param, request, response } = call;
  const patient = patientOf(call);
  const values = await bodyOf<{ readonly startsAt?: string; readonly providerId?: string }>(
    request,
  );
  const wrong = timeProblems(values);
  if (wrong.length > 0) {
    problem(response, 'VALIDATION_FAILED', { errors: wrong });
    return;
  }
  if (param === undefined || !UUID.test(param)) {
    problem(response, 'NOT_FOUND');
    return;
  }
  const key = keyOf(call);
  if (key === undefined) return;
  const old = ownRow(call);
  if (old === undefined) {
    problem(response, 'NOT_FOUND');
    return;
  }
  const startsAt = values.startsAt ?? '';
  const providerId = values.providerId?.toLowerCase();
  const fingerprint = JSON.stringify(['reschedule', old.id, startsAt, providerId ?? null]);
  if (replayed(call, key, fingerprint)) return;

  const wanted: Wanted = { serviceId: old.serviceId, startsAt, providerId };
  // It moves an appointment, so BR-02 has nothing to count.
  const refusal: Refusal | undefined =
    whyNotChangeable(old, practice) ??
    (isProfileComplete(practice, patient) ? undefined : { code: 'PATIENT_PROFILE_INCOMPLETE' }) ??
    whyNotBookable(person, practice, wanted) ??
    whyNoSlot(person, practice, wanted, old);
  if (refusal !== undefined) {
    problem(response, refusal.code, refusal);
    return;
  }
  const moved = place(person, practice, patient, wanted, old.patientNote);
  old.status = 'CANCELLED';
  old.patientNote = undefined;
  old.movedTo = moved.id;
  person.keys.set(`${practice.id}:${key}`, { request: fingerprint, appointmentId: moved.id });
  respond(response, 201, viewOf(person, moved));
}

function compareStarts(first: Appointment, second: Appointment): number {
  return (
    Date.parse(first.startsAt) - Date.parse(second.startsAt) || first.id.localeCompare(second.id)
  );
}

/** A page of a practice's list: upcoming soonest first, past latest first, and the cursor an id. */
function listInPractice({ person, practice, searchParams, response }: Call): void {
  const scope = searchParams.get('scope') ?? 'upcoming';
  const limit = Number(searchParams.get('limit') ?? DEFAULT_PAGE_SIZE);
  if (scope !== 'upcoming' && scope !== 'past') {
    problem(response, 'VALIDATION_FAILED', { errors: [{ field: 'scope', code: 'INVALID_VALUE' }] });
    return;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    problem(response, 'VALIDATION_FAILED', { errors: [{ field: 'limit', code: 'TOO_LARGE' }] });
    return;
  }
  const rows = appointmentsAt(person, practice.id)
    .filter((appointment) => isUpcoming(appointment) === (scope === 'upcoming'))
    .toSorted((first, second) =>
      scope === 'upcoming' ? compareStarts(first, second) : compareStarts(second, first),
    );
  const cursor = searchParams.get('cursor');
  const position = cursor === null ? undefined : Buffer.from(cursor, 'base64url').toString('utf8');
  const after = position === undefined ? -1 : rows.findIndex(({ id }) => id === position);
  if (position !== undefined && after === -1) {
    problem(response, 'VALIDATION_FAILED', {
      errors: [{ field: 'cursor', code: 'INVALID_FORMAT' }],
    });
    return;
  }
  const items = rows.slice(after + 1, after + 1 + limit);
  const last = items.at(-1);
  respond(response, 200, {
    items: items.map((appointment) => viewOf(person, appointment)),
    nextCursor:
      after + 1 + limit < rows.length && last !== undefined
        ? Buffer.from(last.id, 'utf8').toString('base64url')
        : null,
  });
}

function myPractices(person: Person): readonly MyPracticeDto[] {
  const row = (id: string, capacity: MyPracticeDto['capacity']): readonly MyPracticeDto[] => {
    const answer = practiceById(id);
    if (answer === undefined) return [];
    const name = { ar: answer('ar').name ?? '', en: answer('en').name ?? '' };
    return [{ id, slug: answer('en').slug, name, capacity }];
  };
  return [
    ...[...person.patients.keys()].flatMap((id) => row(id, 'PATIENT')),
    ...[...person.staffAt].flatMap((id) => row(id, 'STAFF')),
    ...person.missing.map(({ practiceId }, index): MyPracticeDto => ({
      id: practiceId,
      slug: null,
      name: {
        en: `Other practice ${String(index + 1)}`,
        ar: `عيادة أخرى ${String(index + 1)}`,
      },
      capacity: 'PATIENT',
    })),
  ];
}

const WRITES: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** What the guards of a route ask of a person: `@PracticeScoped` on the API's controllers. */
type Access = 'patient' | 'confirmed-patient' | 'join';

interface Route {
  readonly method: string;
  readonly path: RegExp;
  readonly access: Access;
  readonly run: (call: Call) => void | Promise<void>;
}

const PRACTICE = '/api/v1/practices/([^/]+)';
const THE_APPOINTMENTS = new RegExp(`^${PRACTICE}/appointments$`);
const AN_APPOINTMENT = new RegExp(`^${PRACTICE}/appointments/([^/]+)$`);
const A_CANCEL = new RegExp(`^${PRACTICE}/appointments/([^/]+)/cancel$`);
const A_RESCHEDULE = new RegExp(`^${PRACTICE}/appointments/([^/]+)/reschedule$`);
const THE_PATIENTS = new RegExp(`^${PRACTICE}/me/patients$`);
const A_PATIENT = new RegExp(`^${PRACTICE}/me/patients/([^/]+)$`);
const THE_LIST = new RegExp(`^${PRACTICE}/me/appointments$`);

const ROUTES: readonly Route[] = [
  { method: 'POST', path: THE_APPOINTMENTS, access: 'confirmed-patient', run: book },
  { method: 'GET', path: AN_APPOINTMENT, access: 'patient', run: readAppointment },
  { method: 'POST', path: A_CANCEL, access: 'patient', run: cancel },
  { method: 'POST', path: A_RESCHEDULE, access: 'confirmed-patient', run: reschedule },
  { method: 'POST', path: THE_PATIENTS, access: 'join', run: join },
  { method: 'GET', path: THE_PATIENTS, access: 'patient', run: listPatients },
  { method: 'GET', path: A_PATIENT, access: 'patient', run: readPatient },
  { method: 'PATCH', path: A_PATIENT, access: 'patient', run: updatePatient },
  { method: 'GET', path: THE_LIST, access: 'patient', run: listInPractice },
];

/** `PracticeContextInterceptor`, in its order: what stands before a route of a practice. */
function whyNotServed(
  owner: string,
  person: Person,
  practiceId: string,
  access: Access,
): Refusal | undefined {
  if (!UUID.test(practiceId)) return { code: 'NOT_FOUND' };
  const id = practiceId.toLowerCase();
  if (access === 'confirmed-patient' && !isVerified(owner)) return { code: 'EMAIL_NOT_VERIFIED' };
  // No row: not there. Only another capacity there: forbidden.
  if (access !== 'join' && !person.patients.has(id)) {
    return { code: person.staffAt.has(id) ? 'FORBIDDEN' : 'NOT_FOUND' };
  }
  if (practiceById(id) === undefined) return { code: 'NOT_FOUND' };
  if (access === 'join' && !isVerified(owner)) return { code: 'EMAIL_NOT_VERIFIED' };
  return undefined;
}

function handlePracticeRoute(
  owner: string | undefined,
  pathname: string,
  searchParams: URLSearchParams,
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  const onThisPath = ROUTES.filter(({ path }) => path.test(pathname));
  if (onThisPath.length === 0) return false;
  const route = onThisPath.find(({ method }) => method === request.method);
  // The router's 404 comes before any guard.
  if (route === undefined) {
    problem(response, 'NOT_FOUND');
    return true;
  }
  if (owner === undefined) {
    problem(response, 'UNAUTHENTICATED');
    return true;
  }
  if (WRITES.has(route.method) && !hasCsrfHeader(request)) {
    problem(response, 'FORBIDDEN');
    return true;
  }
  const person = personOf(owner);
  const [, practiceId = '', param] = route.path.exec(pathname) ?? [];
  const refusal = whyNotServed(owner, person, practiceId, route.access);
  if (refusal !== undefined) {
    problem(response, refusal.code, refusal);
    return true;
  }
  const practice = practiceOf(person, practiceId.toLowerCase());
  const call = { owner, person, practice, param, searchParams, request, response };
  // A stub that fails says so in the test that met it, and does not stop for all the others.
  void (async () => route.run(call))().catch(() => {
    problem(response, 'INTERNAL_ERROR');
  });
  return true;
}

/** The routes across a person's practices, from the platform database and the fan-out. */
function handleAcrossPractices(
  owner: string | undefined,
  pathname: string,
  { method }: IncomingMessage,
  response: ServerResponse,
): boolean {
  if (pathname !== '/api/v1/me/practices' && pathname !== '/api/v1/me/appointments') return false;
  if (method !== 'GET') {
    problem(response, 'NOT_FOUND');
    return true;
  }
  if (owner === undefined) {
    problem(response, 'UNAUTHENTICATED');
    return true;
  }
  const person = personOf(owner);
  if (pathname === '/api/v1/me/practices') {
    if (person.practicesLimited > 0) {
      person.practicesLimited -= 1;
      problem(response, 'RATE_LIMITED', {}, { 'Retry-After': SECONDS_A_THROTTLE_WAITS });
    } else respond(response, 200, { items: myPractices(person) });
    return true;
  }
  const { listLimited } = person;
  if (listLimited.times > 0) {
    listLimited.times -= 1;
    problem(response, 'RATE_LIMITED', {}, { 'Retry-After': listLimited.retryAfterSeconds });
    return true;
  }
  respond(response, 200, {
    items: person.appointments
      .filter(isUpcoming)
      .toSorted(compareStarts)
      .map((appointment) => viewOf(person, appointment)),
    unavailablePractices: person.missing,
  });
  return true;
}

/** The practice ids that stand in for what a person's list could not read: named in `myPractices`. */
const OTHER_PRACTICES = [
  '40000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000003',
];

/** Booked rows that have begun, as many as asked for, each a day before the last. Needs a join. */
function pastVisits(person: Person, searchParams: URLSearchParams): boolean {
  const practiceId = searchParams.get('practiceId') ?? PRACTICE_ID;
  const patient = person.patients.get(practiceId);
  if (patient === undefined) return false;
  const count = Number(searchParams.get('count') ?? 1);
  for (let index = 0; index < count; index += 1) {
    person.appointments.push({
      id: randomUUID(),
      practiceId,
      patientId: patient.id,
      serviceId: SERVICE_ID,
      providerId: DOCTOR_ID,
      startsAt: new Date(Date.parse(PAST_VISIT) - index * DAY_MS).toISOString(),
      patientNote: undefined,
      status: 'BOOKED',
    });
  }
  return true;
}

/** What only the tests ask for, about one person. */
function handleTestHook(
  pathname: string,
  searchParams: URLSearchParams,
  response: ServerResponse,
): boolean {
  if (!pathname.startsWith('/__')) return false;
  const person = personOf(searchParams.get('email') ?? '');
  switch (pathname) {
    case '/__take-time':
      person.takenTimes.add(searchParams.get('startsAt') ?? '');
      break;
    case '/__missing':
      // In the order given; without any, everything can be read again.
      person.missing = (searchParams.get('reasons') ?? '')
        .split(',')
        .filter((reason) => reason !== '')
        .map((reason, index) => ({
          practiceId: OTHER_PRACTICES[index] ?? '',
          reason: reason as UnavailablePracticeDto['reason'],
        }));
      break;
    case '/__needs-consent':
      person.needsConsent = true;
      break;
    // The practice now asks for a provider and a number, of everyone with insurance.
    case '/__profile-incomplete':
      person.asksEverything = true;
      break;
    case '/__list-limited':
      person.listLimited = {
        times: Number(searchParams.get('times')),
        retryAfterSeconds: searchParams.get('retryAfterSeconds') ?? '1',
      };
      break;
    case '/__practices-limited':
      person.practicesLimited = Number(searchParams.get('times'));
      break;
    case '/__lose-answer':
      person.losesNextAnswer = true;
      break;
    case '/__booking-window':
      person.maxHorizonDays = Number(searchParams.get('maxHorizonDays'));
      break;
    case '/__booking-limit':
      person.maxFutureAppointments = Number(searchParams.get('max'));
      break;
    case '/__join-limit':
      person.joinsPerDay = 0;
      break;
    case '/__refuse-note':
      person.noteRefused = true;
      break;
    case '/__service-offline':
      person.serviceOffline = true;
      break;
    case '/__hide-doctor':
      person.doctorHidden = true;
      break;
    case '/__staff-row':
      person.staffAt.add(searchParams.get('practiceId') ?? PRACTICE_ID);
      break;
    case '/__past-visit':
      if (!pastVisits(person, searchParams)) {
        problem(response, 'NOT_FOUND');
        return true;
      }
      break;
    case '/__appointments':
      respond(response, 200, person.appointments);
      return true;
    case '/__patient':
      respond(
        response,
        200,
        person.patients.get(searchParams.get('practiceId') ?? PRACTICE_ID) ?? null,
      );
      return true;
    default:
      return false;
  }
  done(response);
  return true;
}

/** A practice's public page, as this person's practices have decided it for them. */
export function publicPracticeFor(
  owner: string | undefined,
  practice: PublicPracticeDto,
): PublicPracticeDto {
  return owner === undefined ? practice : asSeenBy(personOf(owner), practice);
}

/** `assertOffered`: a service or a doctor gone from the public page answers 404 for its free times. */
export function isOffered(
  owner: string | undefined,
  practice: PublicPracticeDto,
  serviceId: string | null,
  providerId: string | null,
): boolean {
  const seen = publicPracticeFor(owner, practice);
  const offline = owner !== undefined && personOf(owner).serviceOffline;
  const hasService = !offline && seen.services.some(({ id }) => id === serviceId);
  return hasService && (providerId === null || seen.team.some(({ id }) => id === providerId));
}

/** The free times of a day, as far as this person knows: what is taken or their own is not free. */
export function freeStarts(
  owner: string | undefined,
  practice: PublicPracticeDto,
  date: string,
  providerId: string | null,
): readonly string[] {
  const starts = startsOn(practice.slug, date, providerId);
  if (owner === undefined) return starts;
  const person = personOf(owner);
  return starts.filter((startsAt) => isFree(person, practice, startsAt, providerId));
}

/** Takes the requests about appointments of a signed-in person, and answers whether it did. */
export function handleBooking(
  owner: string | undefined,
  pathname: string,
  searchParams: URLSearchParams,
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  return (
    handleTestHook(pathname, searchParams, response) ||
    handleAcrossPractices(owner, pathname, request, response) ||
    handlePracticeRoute(owner, pathname, searchParams, request, response)
  );
}

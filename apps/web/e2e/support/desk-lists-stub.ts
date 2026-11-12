/**
 * The team's lists (M05, W5 and W8) as the API answers them, over the stub's appointments of
 * `desk-stub.ts`: the catalogue, the appointments of some days, the patients and one record. A
 * search is the body of a POST, as the API takes it, so that nothing typed is in a URL; a page
 * after a cursor has no total, as the API counts only on the first page. The search folds names as
 * the API's `patient-search.rules.ts` does, which its own tests prove.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  DeskAppointmentPageDto,
  DeskAppointmentSearchDto,
  DeskCatalogDto,
  DeskPatientChangeDto,
  DeskPatientExportDto,
  DeskPatientPageDto,
  DeskPatientRecordDto,
  DeskPatientRowDto,
  DeskPatientSearchDto,
  PatientDto,
} from '@medibooker/api-client';
import { bodyOf, problem, respond } from './answers.ts';
import {
  addedPatientsOf,
  type Appointment,
  type DeskAccess,
  dayOf,
  detailsOf,
  NOW,
  PROVIDER_ID,
  rowOf,
  SERVICES,
  SETTINGS,
  TODAY,
} from './desk-stub.ts';

const DEFAULT_LIMIT = 20;
const DAY_MS = 86_400_000;
const IGNORED = /[\u{0300}-\u{036F}\u{064B}-\u{0655}\u{0670}\u{0640}]/gu;

/**
 * Patients without an appointment this week, so that the patients make more than one page: 19
 * and the 6 of the week are 25, a first page of 20 and a second of 5. Synthetic names only.
 */
const QUIET_PATIENTS: readonly DeskPatientRowDto[] = Array.from({ length: 19 }, (_, index) => ({
  id: `00000000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`,
  firstName: 'Quiet',
  lastName: `Example ${String(index + 1).padStart(2, '0')}`,
  insuranceType: 'SELF_PAY',
  dateOfBirth: '1980-01-01',
  age: 46,
  phone: null,
  insuranceProvider: null,
  hasAccount: false,
  lastVisitAt: null,
  nextAppointmentAt: null,
}));

function folded(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(IGNORED, '')
    .replaceAll('\u{0671}', '\u{0627}')
    .replaceAll('\u{0649}', '\u{064A}')
    .replaceAll('\u{0629}', '\u{0647}')
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

/** Every word of a search in the name; a search of one letter looks for nothing. */
function matches(name: string, query: string | undefined): boolean {
  const words = folded(query ?? '')
    .split(' ')
    .filter((word) => word.length >= 2);
  return words.every((word) => folded(name).includes(word));
}

/**
 * A page of a list after the cursor, which names the last row of the page before, and the total on
 * the first page only.
 */
function pageOf<T extends { readonly id: string }>(
  all: readonly T[],
  { limit = DEFAULT_LIMIT, cursor }: { readonly limit?: number; readonly cursor?: string },
): { readonly items: T[]; readonly nextCursor: string | null; readonly total: number | null } {
  const start = cursor === undefined ? 0 : all.findIndex(({ id }) => id === cursor) + 1;
  const items = all.slice(start, start + limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: start + limit < all.length && last !== undefined ? last.id : null,
    total: cursor === undefined ? all.length : null,
  };
}

function plusDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function appointmentsAnswer(
  owner: string,
  search: DeskAppointmentSearchDto,
): DeskAppointmentPageDto {
  const from = search.from ?? TODAY;
  const to = search.to ?? plusDays(from, 6);
  const all = [...dayOf(owner).values()]
    .filter((appointment) => appointment.date >= from && appointment.date <= to)
    .filter((appointment) =>
      matches(`${appointment.firstName} ${appointment.lastName}`, search.query),
    )
    .map(rowOf)
    .filter((row) => search.status === undefined || row.status === search.status)
    .filter((row) => search.serviceId === undefined || row.serviceId === search.serviceId)
    .filter((row) => search.providerId === undefined || row.providerId === search.providerId)
    .filter((row) => search.patientId === undefined || row.patient.id === search.patientId)
    .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { ...pageOf(all, search), from, to, today: TODAY, ...SETTINGS };
}

function patientOf(appointment: Appointment): DeskPatientRowDto {
  const row = rowOf(appointment);
  const visited = row.status === 'COMPLETED' || row.status === 'CHECKED_IN';
  const coming = row.status === 'BOOKED' && Date.parse(row.startsAt) > Date.parse(NOW);
  return {
    ...row.patient,
    dateOfBirth: '1990-04-12',
    age: 36,
    phone: '+966 50 000 0000',
    insuranceProvider: appointment.insuranceType === 'SELF_PAY' ? null : 'Synthetic Insurance',
    hasAccount: appointment.bookedOnline,
    lastVisitAt: visited ? row.startsAt : null,
    nextAppointmentAt: coming ? row.startsAt : null,
  };
}

/** Every patient of the stub's practice for this account: of the week, quiet ones, and added ones. */
export function patientsOf(owner: string): DeskPatientRowDto[] {
  const ofTheWeek = [...dayOf(owner).values()].filter(({ patientId }) => patientId === undefined);
  return [...ofTheWeek.map(patientOf), ...QUIET_PATIENTS, ...addedPatientsOf(owner)];
}

function patientsAnswer(owner: string, search: DeskPatientSearchDto): DeskPatientPageDto {
  const all = patientsOf(owner)
    .filter((patient) => matches(`${patient.firstName} ${patient.lastName}`, search.query))
    .filter(
      (patient) =>
        search.insuranceType === undefined || patient.insuranceType === search.insuranceType,
    )
    .toSorted(
      (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
    );
  return { ...pageOf(all, search), ...SETTINGS };
}

function recordOf(appointment: Appointment): DeskPatientRecordDto {
  const details = detailsOf(appointment);
  const row = rowOf(appointment);
  const coming = row.status === 'BOOKED' && Date.parse(row.startsAt) > Date.parse(NOW);
  return {
    // A profile the practice keeps has no account, and so no address.
    patient: { ...details.patient, email: appointment.bookedOnline ? details.patient.email : null },
    hasAccount: appointment.bookedOnline,
    insuranceNumberEnd: appointment.insuranceType === 'SELF_PAY' ? null : '6789',
    upcoming: coming ? [row] : [],
    recent: coming ? [] : [row],
    ...SETTINGS,
  };
}

/** The appointments of one patient of the stub's day, the first of which names them. */
function appointmentsOfPatient(owner: string, patientId: string | undefined): Appointment[] {
  return [...dayOf(owner).values()].filter(
    (appointment) => rowOf(appointment).patient.id === patientId,
  );
}

/**
 * The team corrects a patient the practice keeps (RT-97): its names and insurance type in every
 * appointment of the stub's day; one of an account is PATIENT_HAS_ACCOUNT, as the API answers.
 */
async function changePatient(
  owner: string,
  patientId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const input = await bodyOf<DeskPatientChangeDto>(request);
  const theirs = appointmentsOfPatient(owner, patientId);
  const first = theirs[0];
  if (first === undefined) {
    problem(response, 'NOT_FOUND');
    return;
  }
  if (first.bookedOnline) {
    problem(response, 'PATIENT_HAS_ACCOUNT');
    return;
  }
  const empty = (['firstName', 'lastName'] as const).filter((field) => input[field] === '');
  if (empty.length > 0) {
    problem(response, 'VALIDATION_FAILED', {
      errors: empty.map((field) => ({ field, code: 'REQUIRED' as const })),
    });
    return;
  }
  const day = dayOf(owner);
  for (const appointment of theirs) {
    day.set(appointment.id, {
      ...appointment,
      firstName: input.firstName ?? appointment.firstName,
      lastName: input.lastName ?? appointment.lastName,
      insuranceType: input.insuranceType ?? appointment.insuranceType,
    });
  }
  const changed = { ...first, ...day.get(first.id) };
  const answer: PatientDto = {
    id: patientId,
    firstName: changed.firstName,
    lastName: changed.lastName,
    dateOfBirth: '1990-04-12',
    phone: input.phone === undefined ? '+966 50 000 0000' : input.phone,
    insuranceType: changed.insuranceType,
    insuranceProvider: changed.insuranceType === 'SELF_PAY' ? null : 'Synthetic Insurance',
    insuranceNumberEnd: changed.insuranceType === 'SELF_PAY' ? null : '6789',
  };
  respond(response, 200, answer);
}

/** The person's copy (Art. 15), for an admin only, as the API answers it. */
function exportOf(appointments: readonly Appointment[]): DeskPatientExportDto | undefined {
  const first = appointments[0];
  if (first === undefined) return undefined;
  const { patient } = recordOf(first);
  return {
    exportedAt: NOW,
    timeZone: SETTINGS.timeZone,
    patient: {
      id: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      phone: patient.phone,
      insuranceType: patient.insuranceType,
      insuranceProvider: patient.insuranceProvider,
      insuranceNumber: patient.insuranceType === 'SELF_PAY' ? null : '123456789',
      hasAccount: first.bookedOnline,
      createdAt: '2026-11-01T15:00:00Z',
      updatedAt: '2026-11-01T15:00:00Z',
    },
    appointments: appointments.map((appointment) => {
      const details = detailsOf(appointment);
      return {
        id: details.id,
        serviceName: details.serviceName,
        providerName: details.providerName,
        startsAt: details.startsAt,
        endsAt: details.endsAt,
        status: details.status,
        bookedAt: details.bookedAt,
        bookedOnline: details.bookedOnline,
        checkedInAt: details.checkedInAt,
        completedAt: details.completedAt,
        cancelledAt: details.cancelledAt,
        patientNote: details.patientNote,
        cancelReason: details.cancelReason,
        limitOverrideReason: details.limitOverrideReason,
        rescheduledFromId: null,
      };
    }),
  };
}

const CATALOG: DeskCatalogDto = {
  providers: [{ id: PROVIDER_ID, name: 'Dr. Lina Example' }],
  services: SERVICES,
  insurance: { types: ['PUBLIC', 'SELF_PAY'], providerTypes: ['PUBLIC'], numberTypes: ['PUBLIC'] },
};

const PRACTICE_DESK = String.raw`^\/api\/v1\/practices\/[^/]+\/desk`;
const SEARCH_PATH = new RegExp(`${PRACTICE_DESK}\\/(appointments|patients)\\/search$`);
const CATALOG_PATH = new RegExp(`${PRACTICE_DESK}\\/catalog$`);
const RECORD_PATH = new RegExp(`${PRACTICE_DESK}\\/patients\\/([^/]+)$`);
const EXPORT_PATH = new RegExp(`${PRACTICE_DESK}\\/patients\\/([^/]+)\\/export$`);

async function answerSearch(
  list: string,
  owner: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (list === 'appointments') {
    respond(
      response,
      200,
      appointmentsAnswer(owner, await bodyOf<DeskAppointmentSearchDto>(request)),
    );
  } else {
    respond(response, 200, patientsAnswer(owner, await bodyOf<DeskPatientSearchDto>(request)));
  }
}

/**
 * Takes the requests of the team's lists, and answers whether it did. Before `handleDesk`, which
 * would take `…/desk/appointments/search` for an appointment.
 */
export function handleDeskLists(
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
  access: () => DeskAccess,
): boolean {
  const search = SEARCH_PATH.exec(pathname)?.[1];
  const isCatalog = CATALOG_PATH.test(pathname);
  const record = search === undefined ? RECORD_PATH.exec(pathname)?.[1] : undefined;
  const exported = EXPORT_PATH.exec(pathname)?.[1];
  if (search === undefined && !isCatalog && record === undefined && exported === undefined) {
    return false;
  }
  const who = access();
  if ('refusal' in who) {
    problem(response, who.refusal);
    return true;
  }
  if (exported !== undefined) {
    const copy = exportOf(appointmentsOfPatient(who.email, exported));
    if (request.method !== 'GET' || copy === undefined) problem(response, 'NOT_FOUND');
    else if (who.role !== 'ADMIN') problem(response, 'FORBIDDEN');
    else respond(response, 200, copy);
    return true;
  }
  if (record !== undefined && request.method === 'PATCH') {
    void changePatient(who.email, record, request, response);
    return true;
  }
  if (request.method !== (search === undefined ? 'GET' : 'POST')) {
    problem(response, 'NOT_FOUND');
    return true;
  }
  if (search !== undefined) {
    void answerSearch(search, who.email, request, response);
  } else if (isCatalog) {
    respond(response, 200, CATALOG);
  } else {
    const appointment = [...dayOf(who.email).values()].find(
      (candidate) => rowOf(candidate).patient.id === record,
    );
    if (appointment === undefined) problem(response, 'NOT_FOUND');
    else respond(response, 200, recordOf(appointment));
  }
  return true;
}

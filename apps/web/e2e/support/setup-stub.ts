/**
 * What the team sets up (M02) as the API answers it, in memory per staff account, so that tests in
 * parallel do not meet: the services, the week and the special days. The rules a screen shows are
 * the API's: who may change what, an overlap named by its interval, one special day per date
 * (`practice-setup.int-spec.ts` proves them on real databases).
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  OpeningIntervalDto,
  ServiceDto,
  ServiceInputDto,
  ServicePatchDto,
  SpecialDayDto,
  SpecialDayInputDto,
} from '@medibooker/api-client';
import { bodyOf, done, problem, respond } from './answers.ts';
import {
  BLOOD_TEST,
  BLOOD_TEST_ID,
  CHECK_UP,
  CHECK_UP_ID,
  PROVIDER_ID,
  SETTINGS,
  TODAY,
  hasPlanning,
  type DeskAccess,
} from './desk-stub.ts';

/** Who asks, as the practice context admitted it. */
type Member = Exclude<DeskAccess, { readonly refusal: unknown }>;

const LOCALES = ['ar', 'en'];
/** A second doctor of the stub practice, without working hours: it can offer no service yet. */
const OTHER_DOCTOR_ID = '70000000-0000-4000-8000-000000000002';
const INSURANCE_TYPES = ['PUBLIC', 'PRIVATE', 'SELF_PAY'] as const;
/** Riyadh: the week starts on Sunday, and Friday and Saturday are the weekend. */
const WEEK = { weekStart: 7, weekendDays: [5, 6] };
const PATH =
  /^\/api\/v1\/practices\/[^/]+\/(services|opening-hours|special-days)(?:\/([^/]+)(\/providers)?)?$/;

interface Setup {
  services: ServiceDto[];
  intervals: OpeningIntervalDto[];
  specialDays: SpecialDayDto[];
}

const setups = new Map<string, Setup>();

function setupOf(email: string): Setup {
  const known = setups.get(email);
  if (known !== undefined) return known;
  const setup: Setup = {
    services: [
      {
        id: CHECK_UP_ID,
        name: CHECK_UP,
        description: { en: 'General examination', ar: 'فحص طبي عام' },
        durationMinutes: 30,
        bufferMinutes: 0,
        referralRequired: false,
        isBookableOnline: true,
        allowedInsuranceTypes: [],
        active: true,
        providers: [{ id: PROVIDER_ID, name: 'Dr. Lina Example' }],
      },
      {
        id: BLOOD_TEST_ID,
        name: BLOOD_TEST,
        description: { en: 'Please come fasting.', ar: 'يرجى الحضور صائمًا.' },
        durationMinutes: 15,
        bufferMinutes: 5,
        referralRequired: true,
        isBookableOnline: false,
        allowedInsuranceTypes: ['SELF_PAY'],
        active: true,
        providers: [],
      },
    ],
    intervals: [7, 1, 2, 3, 4].map((weekday) => ({ weekday, opensAt: '08:00', closesAt: '16:00' })),
    specialDays: [],
  };
  setups.set(email, setup);
  return setup;
}

/** The texts as the API keeps them: trimmed, without the empty ones. */
function textsOf(texts: Readonly<Record<string, unknown>> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(texts ?? {}).flatMap(([locale, text]) =>
      typeof text === 'string' && text.trim() !== '' ? [[locale, text.trim()]] : [],
    ),
  );
}

function sortedWeek(intervals: readonly OpeningIntervalDto[]): OpeningIntervalDto[] {
  return intervals.toSorted((a, b) => a.weekday - b.weekday || a.opensAt.localeCompare(b.opensAt));
}

async function answerServices(
  setup: Setup,
  id: string | undefined,
  who: Member,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === 'GET' && id === undefined) {
    respond(response, 200, {
      services: setup.services,
      locales: LOCALES,
      insuranceTypes: INSURANCE_TYPES,
      doctors: [
        { id: PROVIDER_ID, name: 'Dr. Lina Example', hasWorkingHours: true },
        { id: OTHER_DOCTOR_ID, name: 'Dr. Omar Example', hasWorkingHours: false },
      ],
      ...SETTINGS,
    });
    return;
  }
  if (!who.managesPractice) {
    problem(response, 'FORBIDDEN');
    return;
  }
  if (request.method === 'POST' && id === undefined) {
    const input = await bodyOf<ServiceInputDto>(request);
    const name = textsOf(input.name);
    const missing = LOCALES.filter((locale) => name[locale] === undefined);
    if (missing.length > 0) {
      problem(response, 'VALIDATION_FAILED', {
        errors: missing.map((locale) => ({ field: `name.${locale}`, code: 'REQUIRED' })),
      });
      return;
    }
    const service: ServiceDto = {
      id: randomUUID(),
      name,
      description: textsOf(input.description),
      durationMinutes: input.durationMinutes,
      bufferMinutes: input.bufferMinutes ?? 0,
      referralRequired: input.referralRequired ?? false,
      isBookableOnline: input.isBookableOnline ?? true,
      allowedInsuranceTypes: [...new Set(input.allowedInsuranceTypes ?? [])],
      active: true,
      providers: [],
    };
    setup.services.push(service);
    respond(response, 201, service);
    return;
  }
  const index = setup.services.findIndex((service) => service.id === id);
  const old = setup.services[index];
  if (request.method !== 'PATCH' || old === undefined) {
    problem(response, 'NOT_FOUND');
    return;
  }
  const change = await bodyOf<ServicePatchDto>(request);
  const service: ServiceDto = {
    ...old,
    ...(change.name === undefined ? {} : { name: textsOf(change.name) }),
    ...(change.description === undefined ? {} : { description: textsOf(change.description) }),
    ...(change.durationMinutes === undefined ? {} : { durationMinutes: change.durationMinutes }),
    ...(change.bufferMinutes === undefined ? {} : { bufferMinutes: change.bufferMinutes }),
    ...(change.referralRequired === undefined ? {} : { referralRequired: change.referralRequired }),
    ...(change.isBookableOnline === undefined ? {} : { isBookableOnline: change.isBookableOnline }),
    ...(change.allowedInsuranceTypes === undefined
      ? {}
      : { allowedInsuranceTypes: [...new Set(change.allowedInsuranceTypes)] }),
    ...(change.active === undefined ? {} : { active: change.active }),
  };
  setup.services[index] = service;
  respond(response, 200, service);
}

/** W13: the doctors who offer a service; a doctor without working hours can offer nothing. */
async function answerProviders(
  setup: Setup,
  id: string | undefined,
  who: Member,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'PUT') {
    problem(response, 'NOT_FOUND');
    return;
  }
  if (!who.managesPractice) {
    problem(response, 'FORBIDDEN');
    return;
  }
  const index = setup.services.findIndex((service) => service.id === id);
  const old = setup.services[index];
  if (old === undefined) {
    problem(response, 'NOT_FOUND');
    return;
  }
  const { providerIds } = await bodyOf<{ providerIds: string[] }>(request);
  const unknown = providerIds.flatMap((providerId, at) =>
    providerId === PROVIDER_ID
      ? []
      : [{ field: `providerIds[${String(at)}]`, code: 'INVALID_VALUE' as const }],
  );
  if (unknown.length > 0) {
    problem(response, 'VALIDATION_FAILED', { errors: unknown });
    return;
  }
  const service: ServiceDto = {
    ...old,
    providers: providerIds.length === 0 ? [] : [{ id: PROVIDER_ID, name: 'Dr. Lina Example' }],
  };
  setup.services[index] = service;
  respond(response, 200, service);
}

async function answerWeek(
  setup: Setup,
  who: Member,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === 'PUT') {
    if (!hasPlanning(who)) {
      problem(response, 'FORBIDDEN');
      return;
    }
    const { intervals } = await bodyOf<{ intervals: OpeningIntervalDto[] }>(request);
    // As the database's EXCLUDE: an interval that overlaps an earlier one of its day is named.
    const overlap = intervals.findIndex((interval, index) =>
      intervals
        .slice(0, index)
        .some(
          (other) =>
            other.weekday === interval.weekday &&
            other.opensAt < interval.closesAt &&
            interval.opensAt < other.closesAt,
        ),
    );
    if (overlap >= 0) {
      problem(response, 'VALIDATION_FAILED', {
        errors: [{ field: `intervals[${String(overlap)}]`, code: 'OVERLAPS_EXISTING' }],
      });
      return;
    }
    setup.intervals = intervals;
  } else if (request.method !== 'GET') {
    problem(response, 'NOT_FOUND');
    return;
  }
  respond(response, 200, { intervals: sortedWeek(setup.intervals), ...WEEK, ...SETTINGS });
}

async function answerSpecialDays(
  setup: Setup,
  id: string | undefined,
  who: Member,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === 'GET' && id === undefined) {
    respond(response, 200, {
      specialDays: setup.specialDays.toSorted((a, b) => a.date.localeCompare(b.date)),
      today: TODAY,
      locales: LOCALES,
      ...SETTINGS,
    });
    return;
  }
  if (!hasPlanning(who)) {
    problem(response, 'FORBIDDEN');
    return;
  }
  if (request.method === 'POST' && id === undefined) {
    const input = await bodyOf<SpecialDayInputDto>(request);
    if (setup.specialDays.some(({ date }) => date === input.date)) {
      problem(response, 'VALIDATION_FAILED', {
        errors: [{ field: 'date', code: 'ALREADY_EXISTS' }],
      });
      return;
    }
    const day: SpecialDayDto = {
      id: randomUUID(),
      date: input.date,
      closed: input.closed,
      opensAt: input.closed ? null : (input.opensAt ?? null),
      closesAt: input.closed ? null : (input.closesAt ?? null),
      label: textsOf(input.label),
    };
    setup.specialDays.push(day);
    respond(response, 201, day);
    return;
  }
  const kept = setup.specialDays.filter((day) => day.id !== id);
  if (request.method !== 'DELETE' || kept.length === setup.specialDays.length) {
    problem(response, 'NOT_FOUND');
    return;
  }
  setup.specialDays = kept;
  done(response);
}

/** Takes the requests of the practice's setup, and answers whether it did. */
export function handleSetup(
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
  access: () => DeskAccess,
): boolean {
  const match = PATH.exec(pathname);
  if (match === null) return false;
  const [, resource, id, providers] = match;
  const who = access();
  if ('refusal' in who) {
    problem(response, who.refusal);
    return true;
  }
  const setup = setupOf(who.email);
  if (resource === 'services' && providers !== undefined) {
    void answerProviders(setup, id, who, request, response);
  } else if (resource === 'services') void answerServices(setup, id, who, request, response);
  else if (resource === 'opening-hours' && id === undefined) {
    void answerWeek(setup, who, request, response);
  } else if (resource === 'special-days') {
    void answerSpecialDays(setup, id, who, request, response);
  } else problem(response, 'NOT_FOUND');
  return true;
}

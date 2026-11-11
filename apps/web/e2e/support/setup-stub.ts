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
  type DeskAccess,
} from './desk-stub.ts';

const LOCALES = ['ar', 'en'];
const INSURANCE_TYPES = ['PUBLIC', 'PRIVATE', 'SELF_PAY'] as const;
/** Riyadh: the week starts on Sunday, and Friday and Saturday are the weekend. */
const WEEK = { weekStart: 7, weekendDays: [5, 6] };
const PATH = /^\/api\/v1\/practices\/[^/]+\/(services|opening-hours|special-days)(?:\/([^/]+))?$/;

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
  role: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === 'GET' && id === undefined) {
    respond(response, 200, {
      services: setup.services,
      locales: LOCALES,
      insuranceTypes: INSURANCE_TYPES,
      ...SETTINGS,
    });
    return;
  }
  if (role !== 'ADMIN') {
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
    ...(change.isBookableOnline === undefined ? {} : { isBookableOnline: change.isBookableOnline }),
    ...(change.allowedInsuranceTypes === undefined
      ? {}
      : { allowedInsuranceTypes: [...new Set(change.allowedInsuranceTypes)] }),
    ...(change.active === undefined ? {} : { active: change.active }),
  };
  setup.services[index] = service;
  respond(response, 200, service);
}

async function answerWeek(
  setup: Setup,
  role: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === 'PUT') {
    if (role === 'DOCTOR') {
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
  role: string,
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
  if (role === 'DOCTOR') {
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
  const [, resource, id] = match;
  const who = access();
  if ('refusal' in who) {
    problem(response, who.refusal);
    return true;
  }
  const setup = setupOf(who.email);
  if (resource === 'services') void answerServices(setup, id, who.role, request, response);
  else if (resource === 'opening-hours' && id === undefined) {
    void answerWeek(setup, who.role, request, response);
  } else if (resource === 'special-days') {
    void answerSpecialDays(setup, id, who.role, request, response);
  } else problem(response, 'NOT_FOUND');
  return true;
}

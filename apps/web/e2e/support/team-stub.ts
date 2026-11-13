/**
 * The practice's team (W15, D17) as the API answers it, in memory per signed-in account, so that tests
 * in parallel do not meet. The rules a screen shows are the API's: practice management only, the last
 * person with practice management stays, one account per doctor, and nothing on one's own account
 * that would lock it out (`team.int-spec.ts` proves them on real databases).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChangeTeamRoleDto, TeamDoctorDto, TeamMemberDto } from '@medibooker/api-client';
import { bodyOf, problem, respond } from './answers.ts';
import { PROVIDER_ID, type DeskAccess } from './desk-stub.ts';

/** A second doctor of the stub practice, whom no account is yet. */
const OTHER_DOCTOR_ID = '70000000-0000-4000-8000-000000000002';
const PATH =
  /^\/api\/v1\/practices\/[^/]+\/staff(?:\/([^/]+)\/(role|deactivate|reactivate|second-factor\/reset))?$/;

/** Who asks, as the practice context admitted it. */
type Member = Exclude<DeskAccess, { readonly refusal: unknown }>;

interface Row {
  readonly id: string;
  readonly name: string | null;
  readonly email: string;
  role: 'STAFF' | 'DOCTOR';
  managesPractice: boolean;
  active: boolean;
  secondFactor: boolean;
  doctorId: string | null;
}

interface Team {
  readonly you: string;
  readonly rows: Row[];
}

const DOCTOR_NAMES = new Map([
  [PROVIDER_ID, 'Dr. Lina Example'],
  [OTHER_DOCTOR_ID, 'Dr. Omar Example'],
]);

const teams = new Map<string, Team>();

function teamOf(who: Member): Team {
  const known = teams.get(who.email);
  if (known !== undefined) return known;
  const you = '80000000-0000-4000-8000-000000000001';
  const team: Team = {
    you,
    rows: [
      {
        id: you,
        name: null,
        email: who.email,
        role: who.role,
        managesPractice: who.managesPractice,
        active: true,
        secondFactor: true,
        doctorId: who.providerId,
      },
      {
        id: '80000000-0000-4000-8000-000000000002',
        name: 'Lina Example',
        email: 'lina.example@example.test',
        role: 'DOCTOR',
        managesPractice: false,
        active: true,
        secondFactor: true,
        doctorId: PROVIDER_ID,
      },
      {
        id: '80000000-0000-4000-8000-000000000003',
        name: 'Sara Example',
        email: 'sara.example@example.test',
        role: 'STAFF',
        managesPractice: false,
        active: true,
        secondFactor: false,
        doctorId: null,
      },
      {
        id: '80000000-0000-4000-8000-000000000004',
        name: 'Nadia Example',
        email: 'nadia.example@example.test',
        role: 'STAFF',
        managesPractice: false,
        active: false,
        secondFactor: true,
        doctorId: null,
      },
    ],
  };
  teams.set(who.email, team);
  return team;
}

function doctorOf(team: Team, doctorId: string): TeamDoctorDto {
  return {
    id: doctorId,
    name: DOCTOR_NAMES.get(doctorId) ?? '',
    membershipId: team.rows.find((row) => row.doctorId === doctorId)?.id ?? null,
  };
}

function memberOf(team: Team, row: Row): TeamMemberDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    managesPractice: row.managesPractice,
    active: row.active,
    secondFactor: row.secondFactor,
    doctor: row.doctorId === null ? null : doctorOf(team, row.doctorId),
    you: row.id === team.you,
  };
}

/** Whether another active member keeps practice management when this one loses it. */
function anotherManager(team: Team, row: Row): boolean {
  return team.rows.some((other) => other !== row && other.active && other.managesPractice);
}

async function changeRole(
  team: Team,
  row: Row,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const input = await bodyOf<ChangeTeamRoleDto>(request);
  if (input.role !== 'DOCTOR' && typeof input.providerId === 'string') {
    problem(response, 'VALIDATION_FAILED', {
      errors: [{ field: 'providerId', code: 'INVALID_VALUE' }],
    });
  } else if (!row.active) problem(response, 'CONFLICT');
  else if (row.managesPractice && !input.managesPractice && !anotherManager(team, row)) {
    problem(response, 'LAST_PRACTICE_MANAGER');
  } else {
    const link =
      input.role !== 'DOCTOR'
        ? null
        : input.providerId === undefined
          ? row.doctorId
          : input.providerId;
    if (link !== null && !DOCTOR_NAMES.has(link)) {
      problem(response, 'VALIDATION_FAILED', {
        errors: [{ field: 'providerId', code: 'INVALID_VALUE' }],
      });
    } else if (
      link !== null &&
      team.rows.some((other) => other !== row && other.doctorId === link)
    ) {
      problem(response, 'DOCTOR_ALREADY_LINKED');
    } else {
      row.role = input.role;
      row.managesPractice = input.managesPractice;
      row.doctorId = link;
      respond(response, 200, memberOf(team, row));
    }
  }
}

/** Takes the requests about the team, and answers whether it did. */
export function handleTeam(
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
  access: () => DeskAccess,
): boolean {
  const match = PATH.exec(pathname);
  if (match === null) return false;
  const [, membershipId, action] = match;
  const who = access();
  if ('refusal' in who) {
    problem(response, who.refusal);
    return true;
  }
  if (!who.managesPractice) {
    problem(response, 'FORBIDDEN');
    return true;
  }
  const team = teamOf(who);
  if (membershipId === undefined) {
    if (request.method === 'GET') {
      respond(response, 200, {
        members: team.rows.map((row) => memberOf(team, row)),
        doctors: [...DOCTOR_NAMES.keys()].map((doctorId) => doctorOf(team, doctorId)),
      });
    } else problem(response, 'NOT_FOUND');
    return true;
  }
  const row = team.rows.find(({ id }) => id === membershipId);
  const method = action === 'role' ? 'PUT' : 'POST';
  if (row === undefined || request.method !== method) {
    problem(response, 'NOT_FOUND');
    return true;
  }
  if (action === 'role') {
    void changeRole(team, row, request, response);
    return true;
  }
  if (action !== 'reactivate' && row.id === team.you) problem(response, 'NOT_ON_YOURSELF');
  else if (action === 'deactivate') {
    if (row.active && row.managesPractice && !anotherManager(team, row)) {
      problem(response, 'LAST_PRACTICE_MANAGER');
      return true;
    }
    row.active = false;
    row.doctorId = null;
    respond(response, 200, memberOf(team, row));
  } else if (action === 'reactivate') {
    row.active = true;
    respond(response, 200, memberOf(team, row));
  } else if (!row.active) problem(response, 'CONFLICT');
  else {
    row.secondFactor = false;
    respond(response, 200, memberOf(team, row));
  }
  return true;
}

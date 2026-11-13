import type { TeamMemberDto } from '@medibooker/api-client';
import { describe, expect, it } from 'vitest';
import {
  countsOf,
  doctorChoicesOf,
  filterOf,
  inView,
  nameOf,
  roleChangeOf,
  sortedTeam,
  type TeamFilter,
} from './team-view';

const DOCTOR_ID = '70000000-0000-4000-8000-000000000001';
const OTHER_DOCTOR_ID = '70000000-0000-4000-8000-000000000002';

function member(overrides: Partial<TeamMemberDto> & Pick<TeamMemberDto, 'id'>): TeamMemberDto {
  return {
    name: null,
    email: `${overrides.id}@example.test`,
    role: 'STAFF',
    managesPractice: false,
    active: true,
    secondFactor: true,
    doctor: null,
    you: false,
    ...overrides,
  };
}

const manager = member({ id: 'manager', name: 'Rana Example', managesPractice: true, you: true });
const doctor = member({
  id: 'doctor',
  name: 'Lina Example',
  role: 'DOCTOR',
  doctor: { id: DOCTOR_ID, name: 'Dr. Lina Example', membershipId: 'doctor' },
});
const managingDoctor = member({
  id: 'managing-doctor',
  name: 'Omar Example',
  role: 'DOCTOR',
  managesPractice: true,
});
const reception = member({ id: 'reception', name: 'Sara Example', secondFactor: false });
const gone = member({ id: 'gone', name: 'Nadia Example', role: 'DOCTOR', active: false });
const team = [manager, doctor, managingDoctor, reception, gone];

describe('inView', () => {
  it('shows the active members by their place, and the deactivated on their own', () => {
    const shown = (filter: TeamFilter): string[] =>
      team.filter((one) => inView(filter, one)).map(({ id }) => id);
    expect(shown('ALL')).toEqual(['manager', 'doctor', 'managing-doctor', 'reception', 'gone']);
    expect(shown('DOCTORS')).toEqual(['doctor', 'managing-doctor']);
    expect(shown('STAFF')).toEqual(['manager', 'reception']);
    expect(shown('MANAGEMENT')).toEqual(['manager', 'managing-doctor']);
    expect(shown('INACTIVE')).toEqual(['gone']);
  });

  it('counts what each view shows', () => {
    expect(countsOf(team)).toEqual({ ALL: 5, DOCTORS: 2, STAFF: 2, MANAGEMENT: 2, INACTIVE: 1 });
  });
});

describe('filterOf', () => {
  it('takes a known view and makes anything else everyone', () => {
    expect(filterOf('DOCTORS')).toBe('DOCTORS');
    expect(filterOf('__proto__')).toBe('ALL');
    expect(filterOf(3)).toBe('ALL');
  });
});

describe('sortedTeam', () => {
  it('puts the active members first, each part in the alphabet of the page', () => {
    const noName = member({ id: 'no-name', email: 'adam@example.test' });
    expect(sortedTeam([gone, reception, noName, doctor], 'en').map(nameOf)).toEqual([
      'adam@example.test',
      'Lina Example',
      'Sara Example',
      'Nadia Example',
    ]);
  });
});

describe('doctorChoicesOf', () => {
  it('offers the member its own doctor and the free ones, but not another account’s', () => {
    const doctors = {
      doctors: [
        { id: DOCTOR_ID, name: 'Dr. Lina Example', membershipId: 'doctor' },
        { id: OTHER_DOCTOR_ID, name: 'Dr. Omar Example', membershipId: null },
      ],
    };
    expect(doctorChoicesOf(doctors, { id: 'doctor' }).map(({ taken }) => taken)).toEqual([
      false,
      false,
    ]);
    expect(doctorChoicesOf(doctors, { id: 'reception' }).map(({ taken }) => taken)).toEqual([
      true,
      false,
    ]);
  });
});

describe('roleChangeOf', () => {
  it('names a doctor’s link, also none, and none for the practice team', () => {
    expect(roleChangeOf({ role: 'DOCTOR', managesPractice: true, doctorId: DOCTOR_ID })).toEqual({
      role: 'DOCTOR',
      managesPractice: true,
      providerId: DOCTOR_ID,
    });
    expect(roleChangeOf({ role: 'DOCTOR', managesPractice: false, doctorId: null })).toEqual({
      role: 'DOCTOR',
      managesPractice: false,
      providerId: null,
    });
    expect(roleChangeOf({ role: 'STAFF', managesPractice: true, doctorId: DOCTOR_ID })).toEqual({
      role: 'STAFF',
      managesPractice: true,
    });
  });
});

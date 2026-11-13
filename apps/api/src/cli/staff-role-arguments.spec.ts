import { describe, expect, it } from 'vitest';
import { parseStaffRoleArguments } from './staff-role-arguments.js';

const DOCTOR_ID = '20000000-0000-4000-8000-000000000001';

describe("the words of the operator's role command (D17)", () => {
  it('makes the first manager when it is given only the e-mail', () => {
    expect(parseStaffRoleArguments([])).toEqual({
      kind: 'set',
      role: 'STAFF',
      managesPractice: true,
      providerId: undefined,
    });
  });

  it('takes a base role, MANAGE and a doctor in any order and any case', () => {
    expect(parseStaffRoleArguments(['manage', DOCTOR_ID.toUpperCase(), 'doctor'])).toEqual({
      kind: 'set',
      role: 'DOCTOR',
      managesPractice: true,
      providerId: DOCTOR_ID,
    });
    expect(parseStaffRoleArguments(['DOCTOR'])).toMatchObject({
      role: 'DOCTOR',
      managesPractice: false,
    });
  });

  it('ends a membership with NONE, and with nothing else', () => {
    expect(parseStaffRoleArguments(['NONE'])).toMatchObject({ kind: 'set', role: null });
    expect(parseStaffRoleArguments(['NONE', 'MANAGE'])).toEqual({
      kind: 'error',
      result: 'UNKNOWN_ROLE',
    });
  });

  it('refuses a word it does not know, the old ADMIN, a repeat and a broken doctor id', () => {
    for (const words of [['ADMIN'], ['STAFF', 'DOCTOR'], ['MANAGE', 'MANAGE'], ['boss']]) {
      expect(parseStaffRoleArguments(words)).toEqual({ kind: 'error', result: 'UNKNOWN_ROLE' });
    }
    expect(parseStaffRoleArguments(['DOCTOR', '20000000-0000-4000'])).toEqual({
      kind: 'error',
      result: 'NO_SUCH_DOCTOR',
    });
  });
});

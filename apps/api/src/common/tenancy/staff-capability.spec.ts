import { describe, expect, it } from 'vitest';
import { hasCapability, plansEveryDoctor, type StaffCapability } from './staff-capability.js';

/** Who has what (D17): the practice team, a doctor, and each with practice management. */
const TABLE: readonly {
  readonly role: 'STAFF' | 'DOCTOR';
  readonly managesPractice: boolean;
  readonly has: readonly StaffCapability[];
}[] = [
  { role: 'STAFF', managesPractice: false, has: ['team', 'planning'] },
  { role: 'DOCTOR', managesPractice: false, has: ['team'] },
  { role: 'STAFF', managesPractice: true, has: ['team', 'planning', 'management'] },
  { role: 'DOCTOR', managesPractice: true, has: ['team', 'planning', 'management'] },
];

describe('the capabilities of a membership (D17)', () => {
  it.each(TABLE)('$role with management $managesPractice has $has', (standing) => {
    for (const capability of ['team', 'planning', 'management'] as const) {
      expect(hasCapability(capability, standing)).toBe(standing.has.includes(capability));
    }
    expect(plansEveryDoctor(standing)).toBe(standing.has.includes('planning'));
  });
});

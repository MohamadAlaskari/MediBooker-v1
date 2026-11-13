import type { StaffRole } from '../../../src/generated/practice/enums.js';

/**
 * A member's place in a test (D17): a base role, or MANAGER for the practice team with practice
 * management, which an admin was before.
 */
export type TeamRole = 'STAFF' | 'DOCTOR' | 'MANAGER';

export function placeOf(role: TeamRole): {
  readonly role: StaffRole;
  readonly managesPractice: boolean;
} {
  return role === 'MANAGER'
    ? { role: 'STAFF', managesPractice: true }
    : { role, managesPractice: false };
}

import type { StaffRole } from '../../generated/practice/enums.js';

/**
 * What a staff route asks of the caller's membership (D17, ADR 0017):
 *
 * - `team`: every active member of the practice.
 * - `planning`: the practice team (STAFF), or practice management: opening hours, special days, the
 *   free times of every doctor. A doctor without it plans only the doctor its membership names.
 * - `management`: practice management: services, the team, settings, exports and the audit log.
 */
export type StaffCapability = 'team' | 'planning' | 'management';

export const STAFF_CAPABILITIES: readonly StaffCapability[] = ['team', 'planning', 'management'];

/** What decides a capability: the base role and the add-on, as the practice database says now. */
export interface StaffStanding {
  readonly role: StaffRole;
  readonly managesPractice: boolean;
}

/** Whether a membership has what a route asks. */
export function hasCapability(capability: StaffCapability, standing: StaffStanding): boolean {
  switch (capability) {
    case 'team':
      return true;
    case 'planning':
      return standing.role === 'STAFF' || standing.managesPractice;
    case 'management':
      return standing.managesPractice;
  }
}

/** Plans the hours and free times of every doctor, not only of the one it is (M04, D17). */
export function plansEveryDoctor(standing: StaffStanding): boolean {
  return hasCapability('planning', standing);
}

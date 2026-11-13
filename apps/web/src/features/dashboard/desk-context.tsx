'use client';

import type { MembershipDtoRole } from '@medibooker/api-client';
import { createContext, useContext } from 'react';

/** Who is at the desk, as the API answered: the installation's practice and the own place in it. */
export interface Desk {
  readonly practiceId: string;
  /** The base role (D17): STAFF the practice team, DOCTOR a doctor. */
  readonly role: MembershipDtoRole;
  /** Practice management (D17): the services, the team, the exports. */
  readonly managesPractice: boolean;
  /** The doctor this account is (M04): a doctor plans only its own hours. */
  readonly providerId: string | null;
}

/**
 * Planning (D17): the practice team and practice management plan every doctor, the opening hours
 * and the special days; a doctor without practice management plans only itself. The API decides
 * (`staff-capability.ts`); a page only leaves out what the API would refuse.
 */
export function hasPlanning({
  role,
  managesPractice,
}: Pick<Desk, 'role' | 'managesPractice'>): boolean {
  return role === 'STAFF' || managesPractice;
}

export const DeskContext = createContext<Desk | undefined>(undefined);

/** Only inside the dashboard, after the API admitted the person: nothing renders before that. */
export function useDesk(): Desk {
  const desk = useContext(DeskContext);
  if (desk === undefined) throw new Error('useDesk outside the dashboard');
  return desk;
}

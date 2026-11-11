'use client';

import type { MembershipDtoRole } from '@medibooker/api-client';
import { createContext, useContext } from 'react';

/** Who is at the desk, as the API answered: the installation's practice and the own role in it. */
export interface Desk {
  readonly practiceId: string;
  readonly role: MembershipDtoRole;
}

export const DeskContext = createContext<Desk | undefined>(undefined);

/** Only inside the dashboard, after the API admitted the person: nothing renders before that. */
export function useDesk(): Desk {
  const desk = useContext(DeskContext);
  if (desk === undefined) throw new Error('useDesk outside the dashboard');
  return desk;
}

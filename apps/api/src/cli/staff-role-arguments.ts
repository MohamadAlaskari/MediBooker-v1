import { z } from 'zod';
import type { StaffRole } from '../generated/practice/enums.js';

/** What the operator's role command was asked to do (D17). */
export type StaffRoleArguments =
  | {
      readonly kind: 'set';
      /** null: the membership ends. */
      readonly role: StaffRole | null;
      readonly managesPractice: boolean;
      readonly providerId: string | undefined;
    }
  | { readonly kind: 'error'; readonly result: 'UNKNOWN_ROLE' | 'NO_SUCH_DOCTOR' };

const ROLES: Readonly<Record<string, StaffRole | null>> = {
  STAFF: 'STAFF',
  DOCTOR: 'DOCTOR',
  NONE: null,
};

/**
 * The words after the e-mail, in any order: a base role or NONE, MANAGE, and a doctor's id. None at
 * all: the practice team with practice management, what the menu's entry is for. Anything else is
 * refused, so that a typo never gives a role nobody asked for.
 */
export function parseStaffRoleArguments(words: readonly string[]): StaffRoleArguments {
  const given = words.map((word) => word.trim()).filter((word) => word !== '');
  if (given.length === 0) {
    return { kind: 'set', role: 'STAFF', managesPractice: true, providerId: undefined };
  }
  let role: StaffRole | null | undefined;
  let managesPractice = false;
  let providerId: string | undefined;
  for (const word of given) {
    const upper = word.toUpperCase();
    if (upper in ROLES && role === undefined) {
      role = ROLES[upper] ?? null;
    } else if (upper === 'MANAGE' && !managesPractice) {
      managesPractice = true;
    } else if (z.uuid().safeParse(word).success && providerId === undefined) {
      providerId = word.toLowerCase();
    } else if (/^[0-9a-f-]{8,}$/i.test(word)) {
      return { kind: 'error', result: 'NO_SUCH_DOCTOR' };
    } else {
      return { kind: 'error', result: 'UNKNOWN_ROLE' };
    }
  }
  // Ending a membership takes nothing along with it.
  if (role === null && (managesPractice || providerId !== undefined)) {
    return { kind: 'error', result: 'UNKNOWN_ROLE' };
  }
  // Not given is the practice team; NONE is null, which ends the membership.
  return { kind: 'set', role: role === undefined ? 'STAFF' : role, managesPractice, providerId };
}

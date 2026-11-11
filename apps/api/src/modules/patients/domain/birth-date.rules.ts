import { isPlausibleBirthDate } from '../../account-profile/domain/profile.rules.js';
import type { FieldProblem } from './insurance.rules.js';

/**
 * A date of birth as a person gave it, for a join (B01) and for a patient the team adds (W7):
 * required, a real date, and one a living person can have. Pure: the caller passes today.
 */
export function birthDateOf(
  value: string | undefined,
  today: Temporal.PlainDate,
): { readonly value: Temporal.PlainDate | undefined; readonly problems: readonly FieldProblem[] } {
  if (value === undefined) {
    return { value: undefined, problems: [{ field: 'dateOfBirth', code: 'REQUIRED' }] };
  }
  try {
    const date = Temporal.PlainDate.from(value, { overflow: 'reject' });
    if (isPlausibleBirthDate(date, today)) return { value: date, problems: [] };
  } catch {
    // A date like 2026-02-31 has the right form and is no date: answered like any other.
  }
  return { value: undefined, problems: [{ field: 'dateOfBirth', code: 'INVALID_VALUE' }] };
}

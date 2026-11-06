/** The rules of a person's own details (BR-10). Pure. */

export const INSURANCE_TYPES = ['PUBLIC', 'PRIVATE', 'SELF_PAY'] as const;
export type InsuranceTypeName = (typeof INSURANCE_TYPES)[number];

const NUMBER_END_LENGTH = 4;
const OLDEST_BIRTH_DATE = Temporal.PlainDate.from('1900-01-01');

/** Self-payers have no insurance to name (BR-10). */
export function needsInsuranceDetails(type: InsuranceTypeName): boolean {
  return type !== 'SELF_PAY';
}

/** The end of a number, so that a person recognises it: never more than half of it. */
export function insuranceNumberEnd(number: string): string {
  const compact = number.replaceAll(/[\s./-]/gu, '');
  const shown = Math.min(NUMBER_END_LENGTH, Math.floor(compact.length / 2));
  return compact.slice(compact.length - shown);
}

/** A day in the past, from a time a person alive today can come from. */
export function isPlausibleBirthDate(date: Temporal.PlainDate, today: Temporal.PlainDate): boolean {
  return (
    Temporal.PlainDate.compare(date, OLDEST_BIRTH_DATE) >= 0 &&
    Temporal.PlainDate.compare(date, today) < 0
  );
}

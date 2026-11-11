import type { InsuranceTypeName } from '../../account-profile/domain/profile.rules.js';
import { checkedInsurance, type InsuranceRules } from '../../patients/domain/insurance.rules.js';

/** The rules of a booking (BR-02, BR-03, BR-08, BR-09). Pure: the service holds the locks. */

/** How long a key answers with its first result. A later retry is a new booking. */
export const IDEMPOTENCY_HOURS = 24;

/** What is known of a patient's insurance, without reading the number itself. */
export interface PatientInsurance {
  readonly type: InsuranceTypeName;
  readonly provider: string | null;
  readonly numberKnown: boolean;
}

/**
 * BR-09: the profile meets what the practice asks today (BR-10). That can have changed since the
 * join, when a practice stops taking a type or starts asking for a number.
 */
export function isProfileComplete(
  rules: InsuranceRules,
  market: string,
  { type, provider, numberKnown }: PatientInsurance,
): boolean {
  const { problems } = checkedInsurance(rules, market, {
    type,
    provider,
    number: undefined,
    numberKnown,
  });
  return problems.length === 0;
}

/** What a service says about being booked. */
export interface BookableService {
  readonly active: boolean;
  readonly isBookableOnline: boolean;
  /** Empty: every type the practice takes. */
  readonly allowedInsuranceTypes: readonly string[];
}

/** BR-08: an active service, bookable online, that allows the patient's insurance type. */
export function isServiceBookable(service: BookableService, insuranceType: string): boolean {
  return (
    service.active &&
    service.isBookableOnline &&
    (service.allowedInsuranceTypes.length === 0 ||
      service.allowedInsuranceTypes.includes(insuranceType))
  );
}

/**
 * BR-08 for the team (W7): an active service that allows the patient's insurance type, also one that
 * patients cannot book online, which is what such a service is for.
 */
export function isServiceBookableByPractice(
  service: BookableService,
  insuranceType: string,
): boolean {
  return isServiceBookable({ ...service, isBookableOnline: true }, insuranceType);
}

/** BR-03, both ends included: the window of `bookableWindow`, which counts elapsed time. */
export function isInBookingWindow(
  startsAt: Temporal.Instant,
  window: { readonly earliest: Temporal.Instant; readonly latest: Temporal.Instant },
): boolean {
  return (
    Temporal.Instant.compare(startsAt, window.earliest) >= 0 &&
    Temporal.Instant.compare(startsAt, window.latest) <= 0
  );
}

/** BR-02: per patient profile, not per account. */
export function hasBookingPlace(futureActive: number, maxFutureAppointments: number): boolean {
  return futureActive < maxFutureAppointments;
}

/** The statuses that count towards BR-02: what has not happened yet. */
export const UPCOMING_STATUSES = ['BOOKED', 'CHECKED_IN'] as const;

/** BR-04: the last moment a patient can cancel or reschedule, in elapsed hours (ADR 0014). */
export function changeableUntil(
  startsAt: Temporal.Instant,
  deadlineHours: number,
): Temporal.Instant {
  return startsAt.subtract({ hours: deadlineHours });
}

export function isChangeable(
  now: Temporal.Instant,
  startsAt: Temporal.Instant,
  deadlineHours: number,
): boolean {
  return Temporal.Instant.compare(now, changeableUntil(startsAt, deadlineHours)) <= 0;
}

/** Its start has come, at the same moment as an appointment leaves the upcoming list. */
export function hasStarted(now: Temporal.Instant, startsAt: Temporal.Instant): boolean {
  return Temporal.Instant.compare(now, startsAt) >= 0;
}

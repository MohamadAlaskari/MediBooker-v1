import { plainDateOf } from '../../common/time/convert.js';
import type {
  OpeningHours,
  PracticePage,
  PracticeSettings,
  PracticeTheme,
  Service,
  SpecialDay,
  StaffMember,
} from '../../generated/practice/client.js';
import {
  INSURANCE_TYPES,
  type InsuranceTypeName,
} from '../account-profile/domain/profile.rules.js';
import { negotiateLocale, textFor } from './domain/locale.js';
import { computeOpenNow } from './domain/open-now.js';
import type { PublicPracticeDto } from './public-practice.dto.js';

/** What the database and the registry say about a practice, as the service read it. */
export interface PublicPracticeRows {
  readonly id: string;
  readonly slug: string;
  readonly name: unknown;
  readonly settings: PracticeSettings;
  readonly page: PracticePage;
  readonly theme: PracticeTheme;
  readonly openingHours: readonly OpeningHours[];
  readonly specialDays: readonly SpecialDay[];
  readonly services: readonly Service[];
  /** Filtered by the query: an active public-profile consent, not hidden (BR-24). */
  readonly team: readonly StaffMember[];
}

/** Minutes after local midnight as a wall-clock time; 1440 is 24:00. */
export function clockOf(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
}

function nullableClockOf(minutes: number | null): string | null {
  return minutes === null ? null : clockOf(minutes);
}

/** The columns are free text, and the contract names the types: a client knows no other. */
function insuranceTypesOf(stored: readonly string[]): readonly InsuranceTypeName[] {
  return INSURANCE_TYPES.filter((type) => stored.includes(type));
}

/**
 * The public view of a practice (BR-22, BR-24) for one request: the texts in the negotiated locale
 * and every field copied by name. Pure: `now` comes from the Clock, `acceptLanguage` from the
 * request.
 */
export function toPublicPractice(
  rows: PublicPracticeRows,
  now: Temporal.Instant,
  acceptLanguage: string | undefined,
): PublicPracticeDto {
  const { settings, page, theme } = rows;
  const { defaultLocale, supportedLocales, timeZone } = settings;
  const locale = negotiateLocale(acceptLanguage, supportedLocales, defaultLocale);
  const text = (value: unknown): string | null => textFor(value, locale, defaultLocale);
  const specialDays = rows.specialDays.map((day) => ({
    ...day,
    isoDate: plainDateOf(day.date).toString(),
  }));
  const open = page.showOpeningHours
    ? computeOpenNow(now, {
        timeZone,
        openingHours: rows.openingHours,
        specialDays: specialDays.map((day) => ({
          date: day.isoDate,
          closed: day.closed,
          opensAt: day.opensAt,
          closesAt: day.closesAt,
        })),
      })
    : null;
  return {
    id: rows.id,
    insuranceTypes: insuranceTypesOf(settings.insuranceTypes),
    insuranceProviderTypes: insuranceTypesOf(settings.insuranceProviderTypes),
    insuranceNumberTypes: insuranceTypesOf(settings.insuranceNumberTypes),
    cancellationDeadlineHours: settings.cancellationDeadlineHours,
    slug: rows.slug,
    name: text(rows.name),
    locale,
    defaultLocale,
    supportedLocales,
    timeZone,
    today: now.toZonedDateTimeISO(timeZone).toPlainDate().toString(),
    weekStart: settings.weekStart,
    weekendDays: settings.weekendDays,
    numberingSystem: settings.numberingSystem,
    hourCycle: settings.hourCycle,
    phone: settings.phone,
    email: settings.email,
    address: text(settings.address),
    about: text(page.about),
    directions: page.showDirections ? text(page.directions) : null,
    legalNoticeUrl: page.legalNoticeUrl,
    privacyPolicyUrl: page.privacyPolicyUrl,
    theme: {
      preset: theme.preset,
      customColor: theme.customColor,
      scale: theme.scale,
      adjusted: theme.adjusted,
      logoUrl: null,
      initials: theme.initials,
    },
    openNow: open === null ? null : open.openNow,
    nextChangeAt: open?.nextChangeAt?.toString() ?? null,
    openingHours: page.showOpeningHours
      ? [...rows.openingHours]
          .sort((a, b) => a.weekday - b.weekday || a.opensAt - b.opensAt)
          .map((hours) => ({
            weekday: hours.weekday,
            opensAt: clockOf(hours.opensAt),
            closesAt: clockOf(hours.closesAt),
          }))
      : [],
    specialDays: page.showOpeningHours
      ? specialDays.map((day) => ({
          date: day.isoDate,
          closed: day.closed,
          opensAt: nullableClockOf(day.opensAt),
          closesAt: nullableClockOf(day.closesAt),
          label: text(day.label),
        }))
      : [],
    services: page.showServices
      ? rows.services.map((service) => ({
          id: service.id,
          name: text(service.name),
          description: text(service.description),
          durationMinutes: service.durationMinutes,
          referralRequired: service.referralRequired,
        }))
      : [],
    team: page.showTeam
      ? [...rows.team]
          .sort((a, b) => a.lastName.localeCompare(b.lastName, locale))
          .map((member) => ({
            id: member.id,
            title: member.title,
            firstName: member.firstName,
            lastName: member.lastName,
            position: text(member.position),
            specialty: text(member.specialty),
            languages: member.languages,
            isProvider: member.isProvider,
            photoUrl: null,
          }))
      : [],
  };
}

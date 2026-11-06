/**
 * What leaves the API about a practice without sign-in: exactly these fields (BR-22, BR-24).
 * Every field is named here and copied one by one, so a new column never becomes public by itself.
 */

export interface PublicThemeDto {
  readonly preset: string;
  readonly customColor: string | null;
  readonly scale: readonly string[];
  readonly adjusted: boolean;
  /** Null until R02 stores logos. */
  readonly logoUrl: null;
  readonly initials: string | null;
}

export interface PublicOpeningHoursDto {
  /** ISO weekday: 1 Monday to 7 Sunday. */
  readonly weekday: number;
  /** Local wall-clock time, for example 09:00; 24:00 is the end of the day. */
  readonly opensAt: string;
  readonly closesAt: string;
}

export interface PublicSpecialDayDto {
  /** ISO date in the practice's time zone. */
  readonly date: string;
  readonly closed: boolean;
  readonly opensAt: string | null;
  readonly closesAt: string | null;
  readonly label: string | null;
}

export interface PublicServiceDto {
  readonly id: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly durationMinutes: number;
}

export interface PublicTeamMemberDto {
  readonly id: string;
  readonly title: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly position: string | null;
  readonly specialty: string | null;
  readonly languages: readonly string[];
  readonly isProvider: boolean;
  /** Null until R02 stores photos, which also need their own consent. */
  readonly photoUrl: null;
}

export interface PublicPracticeDto {
  /** The current slug, also when the request used a retired one. */
  readonly slug: string;
  readonly name: string | null;
  /** The locale of the texts in this response, also in `Content-Language`. */
  readonly locale: string;
  readonly defaultLocale: string;
  readonly supportedLocales: readonly string[];
  /** IANA zone: every time of this response is local to it. */
  readonly timeZone: string;
  readonly weekStart: number;
  readonly weekendDays: readonly number[];
  readonly numberingSystem: string;
  readonly hourCycle: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly about: string | null;
  /** Null when the practice hides its directions. */
  readonly directions: string | null;
  readonly legalNoticeUrl: string | null;
  readonly privacyPolicyUrl: string | null;
  readonly theme: PublicThemeDto;
  /** Null when the practice hides its opening hours. */
  readonly openNow: boolean | null;
  /** An instant (UTC); null when nothing changes within 60 days or the hours are hidden. */
  readonly nextChangeAt: string | null;
  readonly openingHours: readonly PublicOpeningHoursDto[];
  /** The next 60 days. */
  readonly specialDays: readonly PublicSpecialDayDto[];
  /** Active and bookable online. */
  readonly services: readonly PublicServiceDto[];
  /** Only members with an active public-profile consent that no admin has hidden. */
  readonly team: readonly PublicTeamMemberDto[];
}

import type {
  PublicOpeningHoursDto,
  PublicPracticeDto,
  PublicSpecialDayDto,
  PublicTeamMemberDto,
} from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import type { PracticeFormat } from '@/lib/format';

/** What the status badge says, as a message key with its arguments. */
export type OpenStatus =
  | { readonly key: 'open' }
  | { readonly key: 'openUntil'; readonly time: string }
  | { readonly key: 'closed' }
  | { readonly key: 'closedUntilToday'; readonly time: string }
  | { readonly key: 'closedUntilDay'; readonly day: string; readonly time: string };

/** Undefined when the practice hides its opening hours. */
export function openStatusOf(
  practice: Pick<PublicPracticeDto, 'openNow' | 'nextChangeAt' | 'today'>,
  format: PracticeFormat,
): OpenStatus | undefined {
  const { openNow, nextChangeAt, today } = practice;
  if (openNow === null) return undefined;
  if (nextChangeAt === null) return { key: openNow ? 'open' : 'closed' };
  const time = format.instantTime(nextChangeAt);
  if (openNow) return { key: 'openUntil', time };
  return format.instantDate(nextChangeAt) === today
    ? { key: 'closedUntilToday', time }
    : { key: 'closedUntilDay', day: format.instantWeekday(nextChangeAt), time };
}

/** The ISO weekday of a date, 1 Monday to 7 Sunday. */
export function isoWeekdayOf(isoDate: string): number {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export interface OpeningRow {
  readonly weekday: number;
  readonly name: string;
  readonly ranges: readonly { readonly from: string; readonly to: string }[];
  readonly isToday: boolean;
}

/** One row per day, starting on the practice's first day of the week. */
export function openingRowsOf(
  practice: { readonly openingHours: readonly PublicOpeningHoursDto[] } & Pick<
    PublicPracticeDto,
    'weekStart' | 'today'
  >,
  format: PracticeFormat,
): readonly OpeningRow[] {
  const todayWeekday = isoWeekdayOf(practice.today);
  return Array.from({ length: 7 }, (_, offset) => {
    const weekday = ((practice.weekStart - 1 + offset) % 7) + 1;
    const ranges = practice.openingHours
      .filter((hours) => hours.weekday === weekday)
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
      .map(({ opensAt, closesAt }) => ({
        from: format.clock(opensAt),
        to: format.clock(closesAt),
      }));
    return { weekday, name: format.weekday(weekday), ranges, isToday: weekday === todayWeekday };
  });
}

export type SpecialDayLine =
  | { readonly key: 'specialClosed'; readonly date: string }
  | { readonly key: 'specialClosedLabel'; readonly date: string; readonly label: string }
  | {
      readonly key: 'specialOpen';
      readonly date: string;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly key: 'specialOpenLabel';
      readonly date: string;
      readonly from: string;
      readonly to: string;
      readonly label: string;
    };

export function specialDayLineOf(day: PublicSpecialDayDto, format: PracticeFormat): SpecialDayLine {
  const date = format.day(day.date);
  const { label, opensAt, closesAt } = day;
  if (day.closed || opensAt === null || closesAt === null) {
    return label === null
      ? { key: 'specialClosed', date }
      : { key: 'specialClosedLabel', date, label: isolate(label) };
  }
  const from = format.clock(opensAt);
  const to = format.clock(closesAt);
  return label === null
    ? { key: 'specialOpen', date, from, to }
    : { key: 'specialOpenLabel', date, from, to, label: isolate(label) };
}

/** First letters only, as text: photos need their own consent (BR-24). */
export function initialsOf(member: Pick<PublicTeamMemberDto, 'firstName' | 'lastName'>): string {
  const segments = new Intl.Segmenter();
  return [member.firstName, member.lastName]
    .map((name) => segments.segment(name.trim())[Symbol.iterator]().next().value?.segment ?? '')
    .join('')
    .toLocaleUpperCase();
}

export function fullNameOf(
  member: Pick<PublicTeamMemberDto, 'title' | 'firstName' | 'lastName'>,
): string {
  return [member.title, member.firstName, member.lastName]
    .filter((part) => part !== null)
    .join(' ');
}

/** A link target a practice wrote: only https reaches the page, so `javascript:` never does. */
export function safeHttpsUrl(value: string | null): string | undefined {
  if (value === null || !URL.canParse(value)) return undefined;
  return new URL(value).protocol === 'https:' ? value : undefined;
}

/** A phone number as a link target: only what dialling uses. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^+\d]/g, '')}`;
}

/** A plain link to a map: nothing is embedded, so the page itself contacts no map service. */
export function mapsHref(address: string): string {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;
}

const SCHEMA_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Structured data for search engines; `<` is escaped, so no text a practice wrote ends the script. */
export function practiceJsonLd(practice: PublicPracticeDto, url: string): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'MedicalClinic',
    name: practice.name,
    url,
    ...(practice.about === null ? {} : { description: practice.about }),
    ...(practice.phone === null ? {} : { telephone: practice.phone }),
    ...(practice.email === null ? {} : { email: practice.email }),
    ...(practice.address === null
      ? {}
      : { address: { '@type': 'PostalAddress', streetAddress: practice.address } }),
    openingHoursSpecification: practice.openingHours.map((hours) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: SCHEMA_DAYS[hours.weekday - 1],
      opens: hours.opensAt,
      closes: hours.closesAt,
    })),
  };
  return JSON.stringify(data).replaceAll('<', '\\u003c');
}

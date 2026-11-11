import type { DeskAppointmentRowDto, DeskDayDto } from '@medibooker/api-client';

export type DayPart = 'morning' | 'afternoon' | 'evening';

/** The part of the day for a greeting, from the hour on the practice's clock. */
export function dayPartOf(hour: number): DayPart {
  if (hour < 12) return 'morning';
  return hour < 18 ? 'afternoon' : 'evening';
}

const ZERO_WIDTH_NON_JOINER = String.fromCodePoint(0x20_0c);

function firstGrapheme(text: string, locale: string): string {
  const [first] = new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text.trim());
  return first?.segment ?? '';
}

/**
 * The letters of an avatar: the first of each name, in capitals where a script has them. Kept apart
 * by a non-joiner, so that two Arabic letters do not join into one word.
 */
export function initialsOf(firstName: string, lastName: string, locale: string): string {
  return [firstName, lastName]
    .map((name) => firstGrapheme(name, locale).toLocaleUpperCase(locale))
    .filter((letter) => letter !== '')
    .join(ZERO_WIDTH_NON_JOINER);
}

export type StatusVariant = 'brandSubtle' | 'info' | 'success' | 'warning' | 'danger';

/** The colours of Figma's status badges: booked, checked in, completed, no-show, cancelled. */
export function statusVariantOf(status: DeskAppointmentRowDto['status']): StatusVariant {
  switch (status) {
    case 'BOOKED': {
      return 'brandSubtle';
    }
    case 'CHECKED_IN': {
      return 'info';
    }
    case 'COMPLETED': {
      return 'success';
    }
    case 'NO_SHOW': {
      return 'warning';
    }
    case 'CANCELLED': {
      return 'danger';
    }
  }
}

export interface DayFigures {
  /** Everything but the cancelled: the visits of the day. */
  readonly appointments: number;
  readonly completed: number;
  /** Checked in or completed: who came. */
  readonly arrived: number;
  /** Checked in and not yet completed: who waits now. */
  readonly waiting: number;
  readonly openTimes: number;
  readonly nextOpenAt: string | null;
  readonly cancelled: number;
  readonly noShow: number;
}

/** The four cards of W1, from the counts of the whole day, not from the rows shown. */
export function figuresOf({ counts, openTimes, nextOpenAt }: DeskDayDto): DayFigures {
  return {
    appointments: counts.booked + counts.checkedIn + counts.completed + counts.noShow,
    completed: counts.completed,
    arrived: counts.checkedIn + counts.completed,
    waiting: counts.checkedIn,
    openTimes,
    nextOpenAt,
    cancelled: counts.cancelled,
    noShow: counts.noShow,
  };
}

/** The change a row of the day offers at once; the others are in its details. */
export function mainActionOf(
  row: Pick<DeskAppointmentRowDto, 'actions'>,
): 'CHECK_IN' | 'COMPLETE' | undefined {
  if (row.actions.includes('CHECK_IN')) return 'CHECK_IN';
  return row.actions.includes('COMPLETE') ? 'COMPLETE' : undefined;
}

/** The days before and after, as the API names a date. */
export function nextDay(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const moved = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days));
  return moved.toISOString().slice(0, 10);
}

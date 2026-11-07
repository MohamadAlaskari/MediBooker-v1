/**
 * An appointment as an .ics file (B04). It names the practice and the time and never the service or
 * a note: a calendar is often shared or synchronised elsewhere, and a service can say what someone has.
 */

const REVOKE_AFTER_MS = 10_000;

interface CalendarEvent {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  /** When it was booked: what the format calls the time of the event's creation. */
  readonly bookedAt: string;
  /** Translated, and without the service. */
  readonly summary: string;
  readonly location: string | null;
}

/** RFC 5545: a UTC time without separators. */
function utcStamp(instant: string): string {
  return new Date(instant)
    .toISOString()
    .replaceAll(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * RFC 5545 §3.3.11: what would end a value or a line goes with a backslash. Other control characters
 * have no place in a value, and some parsers end a line at them.
 */
function escaped(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r\n?|\n/g, '\\n')
    .replaceAll(/\p{Cc}/gu, '');
}

export function calendarFile(event: CalendarEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MediBooker//Appointments//EN',
    'BEGIN:VEVENT',
    `UID:${event.id}@medibooker`,
    `DTSTAMP:${utcStamp(event.bookedAt)}`,
    `DTSTART:${utcStamp(event.startsAt)}`,
    `DTEND:${utcStamp(event.endsAt)}`,
    `SUMMARY:${escaped(event.summary)}`,
    ...(event.location === null ? [] : [`LOCATION:${escaped(event.location)}`]),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/** Hands the file to the browser, as a download. Its name is what the person sees in the download list. */
export function downloadCalendarFile(event: CalendarEvent, name: string): void {
  const url = URL.createObjectURL(
    new Blob([calendarFile(event)], { type: 'text/calendar;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.ics`;
  link.click();
  // Not at once: some browsers start reading the file only after this click has returned.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_AFTER_MS);
}

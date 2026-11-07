import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarFile, downloadCalendarFile } from './calendar-file';

const EVENT = {
  id: '30000000-0000-4000-8000-000000000001',
  startsAt: '2026-11-10T06:00:00Z',
  endsAt: '2026-11-10T06:30:00Z',
  bookedAt: '2026-11-08T05:00:00Z',
  summary: 'Appointment at Al Noor',
  location: '12 Al Noor Street, Building 4',
};

describe('downloadCalendarFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('names the file in the language of the page', () => {
    vi.useFakeTimers();
    const link = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('document', { createElement: () => link });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:file');
    downloadCalendarFile(EVENT, 'موعد');
    expect(link.download).toBe('موعد.ics');
    expect(link.click).toHaveBeenCalledOnce();
  });
});

describe('calendarFile', () => {
  it('writes one event with its times in UTC, and lines as the format wants them', () => {
    const file = calendarFile(EVENT);
    expect(file.split('\r\n')).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MediBooker//Appointments//EN',
      'BEGIN:VEVENT',
      `UID:${EVENT.id}@medibooker`,
      'DTSTAMP:20261108T050000Z',
      'DTSTART:20261110T060000Z',
      'DTEND:20261110T063000Z',
      'SUMMARY:Appointment at Al Noor',
      'LOCATION:12 Al Noor Street\\, Building 4',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
  });

  it('leaves out a location that is not known', () => {
    expect(calendarFile({ ...EVENT, location: null })).not.toContain('LOCATION');
  });

  it('keeps text from ending a value or a line', () => {
    const file = calendarFile({ ...EVENT, summary: 'a;b\\c\r\nX-EVIL:1' });
    expect(file).toContain('SUMMARY:a\\;b\\\\c\\nX-EVIL:1');
    expect(file.split('\r\n')).not.toContain('X-EVIL:1');
  });

  it('keeps a lone line ending and other control characters out, whatever a parser splits at', () => {
    const summary = `a${String.fromCodePoint(0x0d)}X-CR:1${String.fromCodePoint(0x0a)}X-LF:1${String.fromCodePoint(0x0b, 0x00, 0x7f)}end`;
    const file = calendarFile({ ...EVENT, summary });
    expect(file).toContain('SUMMARY:a\\nX-CR:1\\nX-LF:1end');
    for (const part of file.split(/[\r\n]+/)) expect(part).not.toMatch(/^X-(CR|LF):1/);
  });
});

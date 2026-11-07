import type { PublicPracticeDto } from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { describe, expect, it } from 'vitest';
import { practiceFormat } from '@/lib/format';
import {
  doctorsOf,
  fullNameOf,
  initialsOf,
  isoWeekdayOf,
  mapsHref,
  openingRowsOf,
  openStatusOf,
  practiceJsonLd,
  safeHttpsUrl,
  specialDayLineOf,
  telHref,
} from './practice-view';

const format = practiceFormat('en', {
  numberingSystem: 'latn',
  hourCycle: 'h23',
  timeZone: 'Asia/Riyadh',
});

describe('doctorsOf', () => {
  const member = {
    title: 'Dr.',
    firstName: 'Lina',
    lastName: 'Mansour',
    specialty: null,
    position: null,
    languages: [],
    photoUrl: null,
  };

  it('offers who sees patients, by name and initials', () => {
    expect(
      doctorsOf([
        { ...member, id: 'a', isProvider: true },
        { ...member, id: 'b', isProvider: false, title: null, firstName: 'Sara' },
      ]),
    ).toEqual([{ id: 'a', name: 'Dr. Lina Mansour', initials: 'LM' }]);
  });
});

describe('openStatusOf', () => {
  const today = '2026-11-08';

  it('says nothing when the practice hides its hours', () => {
    expect(openStatusOf({ openNow: null, nextChangeAt: null, today }, format)).toBeUndefined();
  });

  it('says until when an open practice closes, in its own zone', () => {
    expect(
      openStatusOf({ openNow: true, nextChangeAt: '2026-11-08T13:00:00Z', today }, format),
    ).toEqual({ key: 'openUntil', time: '16:00' });
  });

  it('says when a closed practice opens: today by the time, later with the day', () => {
    expect(
      openStatusOf({ openNow: false, nextChangeAt: '2026-11-08T17:00:00Z', today }, format),
    ).toEqual({ key: 'closedUntilToday', time: '20:00' });
    expect(
      openStatusOf({ openNow: false, nextChangeAt: '2026-11-09T05:00:00Z', today }, format),
    ).toEqual({ key: 'closedUntilDay', day: 'Monday', time: '08:00' });
  });

  it('uses the local day, not the UTC day, to tell today from tomorrow', () => {
    // 21:30 UTC is already 00:30 on the next day in Riyadh.
    expect(
      openStatusOf({ openNow: false, nextChangeAt: '2026-11-08T21:30:00Z', today }, format),
    ).toEqual({ key: 'closedUntilDay', day: 'Monday', time: '00:30' });
  });

  it('says only open or closed when nothing changes soon', () => {
    expect(openStatusOf({ openNow: true, nextChangeAt: null, today }, format)).toEqual({
      key: 'open',
    });
    expect(openStatusOf({ openNow: false, nextChangeAt: null, today }, format)).toEqual({
      key: 'closed',
    });
  });
});

describe('isoWeekdayOf', () => {
  it.each([
    ['2026-11-09', 1],
    ['2026-11-13', 5],
    ['2026-11-08', 7],
  ])('%s is %i', (date, weekday) => {
    expect(isoWeekdayOf(date)).toBe(weekday);
  });
});

describe('openingRowsOf', () => {
  const practice = {
    weekStart: 7,
    today: '2026-11-09',
    openingHours: [
      { weekday: 1, opensAt: '14:00', closesAt: '18:00' },
      { weekday: 1, opensAt: '08:00', closesAt: '12:00' },
      { weekday: 7, opensAt: '08:00', closesAt: '16:00' },
    ],
  };

  it('starts on the first day of the practice and has seven days', () => {
    const rows = openingRowsOf(practice, format);
    expect(rows.map(({ weekday }) => weekday)).toEqual([7, 1, 2, 3, 4, 5, 6]);
    expect(openingRowsOf({ ...practice, weekStart: 1 }, format)[0]?.weekday).toBe(1);
  });

  it('marks today only, and sorts the ranges of a day', () => {
    const rows = openingRowsOf(practice, format);
    expect(rows.filter(({ isToday }) => isToday).map(({ name }) => name)).toEqual(['Monday']);
    expect(rows[1]?.ranges).toEqual([
      { from: '08:00', to: '12:00' },
      { from: '14:00', to: '18:00' },
    ]);
  });

  it('gives a day without hours no ranges', () => {
    expect(openingRowsOf(practice, format)[2]?.ranges).toEqual([]);
  });
});

describe('specialDayLineOf', () => {
  const base = { date: '2026-11-19', closed: true, opensAt: null, closesAt: null, label: null };
  const date = 'Thu, Nov 19';

  it('covers closed and open days, with and without a label', () => {
    expect(specialDayLineOf(base, format)).toEqual({ key: 'specialClosed', date });
    expect(specialDayLineOf({ ...base, label: 'Training' }, format)).toEqual({
      key: 'specialClosedLabel',
      date,
      label: isolate('Training'),
    });
    const open = { ...base, closed: false, opensAt: '09:00', closesAt: '12:00' };
    expect(specialDayLineOf(open, format)).toEqual({
      key: 'specialOpen',
      date,
      from: '09:00',
      to: '12:00',
    });
    expect(specialDayLineOf({ ...open, label: 'Eve' }, format)).toEqual({
      key: 'specialOpenLabel',
      date,
      from: '09:00',
      to: '12:00',
      label: isolate('Eve'),
    });
  });

  it('treats an open day without times as closed', () => {
    expect(specialDayLineOf({ ...base, closed: false }, format).key).toBe('specialClosed');
  });
});

describe('team member names', () => {
  it('takes the first letter of each name, also in Arabic', () => {
    expect(initialsOf({ firstName: 'lina', lastName: 'Mansour' })).toBe('LM');
    expect(initialsOf({ firstName: 'لينا', lastName: ' منصور' })).toBe('لم');
    expect(initialsOf({ firstName: '', lastName: '' })).toBe('');
  });

  it('writes the title only when there is one', () => {
    expect(fullNameOf({ title: 'Dr.', firstName: 'Lina', lastName: 'Mansour' })).toBe(
      'Dr. Lina Mansour',
    );
    expect(fullNameOf({ title: null, firstName: 'Lina', lastName: 'Mansour' })).toBe(
      'Lina Mansour',
    );
  });
});

describe('link targets', () => {
  it.each([
    ['https://example.test/legal', 'https://example.test/legal'],
    ['http://example.test/legal', undefined],
    ['javascript:alert(1)', undefined],
    ['data:text/html,x', undefined],
    ['not a url', undefined],
    [null, undefined],
  ])('safeHttpsUrl(%j) is %j', (value, expected) => {
    expect(safeHttpsUrl(value)).toBe(expected);
  });

  it('keeps only what dialling uses', () => {
    expect(telHref('+966 11 (000) 00-00')).toBe('tel:+96611000 0000'.replace(' ', ''));
    expect(telHref('javascript:alert(1)')).toBe('tel:1');
  });

  it('encodes the address for the map link', () => {
    expect(mapsHref('12 Al Noor & Co')).toBe(
      'https://www.openstreetmap.org/search?query=12%20Al%20Noor%20%26%20Co',
    );
  });
});

describe('practiceJsonLd', () => {
  const practice = {
    name: '</script><script>alert(1)</script>',
    about: null,
    phone: null,
    email: null,
    address: null,
    openingHours: [{ weekday: 7, opensAt: '08:00', closesAt: '16:00' }],
  } as unknown as PublicPracticeDto;

  it('escapes every angle bracket that could end the script', () => {
    const text = practiceJsonLd(practice, 'https://example.test/en/x');
    expect(text).not.toContain('<');
    expect(JSON.parse(text)).toMatchObject({ name: practice.name });
  });

  it('leaves out what is unknown and names the days for search engines', () => {
    expect(JSON.parse(practiceJsonLd(practice, 'https://example.test'))).toEqual({
      '@context': 'https://schema.org',
      '@type': 'MedicalClinic',
      name: practice.name,
      url: 'https://example.test',
      openingHoursSpecification: [
        {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: 'Sunday',
          opens: '08:00',
          closes: '16:00',
        },
      ],
    });
  });

  it('includes what is known', () => {
    const full = {
      ...practice,
      about: 'About',
      phone: '+1',
      email: 'a@example.test',
      address: 'Street 1',
    };
    expect(JSON.parse(practiceJsonLd(full, 'https://example.test'))).toMatchObject({
      description: 'About',
      telephone: '+1',
      email: 'a@example.test',
      address: { '@type': 'PostalAddress', streetAddress: 'Street 1' },
    });
  });
});

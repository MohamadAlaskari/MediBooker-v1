import type { PublicPracticeDto } from '@medibooker/api-client';
import { formats, messages, type Locale } from '@medibooker/i18n';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PracticePage } from './practice-page';

const PRACTICE: PublicPracticeDto = {
  id: '40000000-0000-4000-8000-000000000001',
  insuranceTypes: ['PUBLIC', 'PRIVATE', 'SELF_PAY'],
  insuranceProviderTypes: ['PUBLIC', 'PRIVATE'],
  insuranceNumberTypes: ['PUBLIC', 'PRIVATE'],
  cancellationDeadlineHours: 24,
  slug: 'al-noor',
  name: 'مركز النور الطبي',
  locale: 'ar',
  defaultLocale: 'ar',
  supportedLocales: ['ar', 'en'],
  timeZone: 'Asia/Riyadh',
  today: '2026-11-08',
  weekStart: 7,
  weekendDays: [5, 6],
  numberingSystem: 'arab',
  hourCycle: 'h23',
  phone: '+966 11 000 0000',
  email: 'info@al-noor.example',
  address: 'شارع النور ١٢',
  about: 'طب الأسرة',
  directions: 'الحافلة ١٢',
  legalNoticeUrl: 'https://al-noor.example/legal',
  privacyPolicyUrl: 'javascript:alert(1)',
  theme: {
    preset: 'TEAL',
    customColor: null,
    scale: [],
    adjusted: false,
    logoUrl: null,
    initials: 'ن',
  },
  openNow: true,
  nextChangeAt: '2026-11-08T13:00:00.000Z',
  openingHours: [{ weekday: 7, opensAt: '08:00', closesAt: '16:00' }],
  specialDays: [
    { date: '2026-11-19', closed: true, opensAt: null, closesAt: null, label: 'تدريب' },
  ],
  services: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      name: 'فحص',
      description: null,
      referralRequired: false,
      durationMinutes: 3,
    },
  ],
  team: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      title: null,
      firstName: 'لينا',
      lastName: 'منصور',
      specialty: 'طب عام',
      position: null,
      languages: ['ar'],
      isProvider: true,
      photoUrl: null,
    },
  ],
};

function render(practice: PublicPracticeDto, locale: Locale = 'ar'): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={messages[locale]}
      formats={formats}
      timeZone="UTC"
    >
      <PracticePage practice={practice} locale={locale} />
    </NextIntlClientProvider>,
  );
}

describe('PracticePage', () => {
  it('writes the open-now text in the zone of the practice, with its digits', () => {
    expect(render(PRACTICE)).toContain('مفتوح الآن · حتى ١٦:٠٠');
  });

  it('writes Arabic plurals with the digits of the practice', () => {
    expect(render(PRACTICE)).toContain('حوالي ٣ دقائق');
  });

  it('highlights today', () => {
    const html = render(PRACTICE);
    expect(html).toContain('aria-current="date"');
    expect(html).toContain('الأحد');
  });

  it('links only to https, so a javascript link of a practice never reaches the page', () => {
    const html = render(PRACTICE);
    expect(html).toContain('https://al-noor.example/legal');
    expect(html).not.toContain('javascript:');
  });

  it('has the hint about medical details next to the e-mail address', () => {
    expect(render(PRACTICE, 'en')).toContain('Please do not send medical details by e-mail.');
  });

  it('opens the map as a plain link that tells nobody where it came from', () => {
    const html = render(PRACTICE);
    expect(html).toContain('openstreetmap.org/search');
    expect(html).toContain('noopener noreferrer');
    expect(html).not.toContain('<iframe');
  });

  it('offers the other language under the same practice, and only one the practice has', () => {
    expect(render(PRACTICE)).toContain('href="/en/al-noor"');
    expect(render({ ...PRACTICE, supportedLocales: ['ar'] })).not.toContain('href="/en/al-noor"');
  });

  it('shows a member by initials as text, without a photo', () => {
    const html = render(PRACTICE);
    expect(html).toContain('لم');
    expect(html).not.toContain('<img');
  });

  it('leaves out the hours when the practice hides them', () => {
    const html = render({ ...PRACTICE, openNow: null, nextChangeAt: null, openingHours: [] });
    expect(html).not.toContain('id="opening-hours"');
    expect(html).not.toContain('href="#opening-hours"');
  });

  it('says what is missing instead of an empty section', () => {
    const html = render({ ...PRACTICE, services: [], team: [] }, 'en');
    expect(html).toContain('Please call us to ask about our services.');
    expect(html).toContain('Our team introduces itself here soon.');
  });

  it('copes without phone, e-mail, address, directions and special days', () => {
    const html = render(
      { ...PRACTICE, phone: null, email: null, address: null, directions: null, specialDays: [] },
      'en',
    );
    expect(html).not.toContain('tel:');
    expect(html).not.toContain('mailto:');
    expect(html).not.toContain('openstreetmap');
  });
});

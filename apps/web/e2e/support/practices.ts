/**
 * The practices of the API stub: synthetic, one for each case a page must handle. Typed by the
 * generated client, so a change of the contract fails the type check here.
 */
import type { PublicPracticeDto } from '@medibooker/api-client';

const WEEKDAY_HOURS = [7, 1, 2, 3, 4].map((weekday) => ({
  weekday,
  opensAt: '08:00',
  closesAt: '16:00',
}));

function practice(overrides: Partial<PublicPracticeDto>): PublicPracticeDto {
  return {
    slug: 'al-noor',
    name: 'Al Noor Medical Centre',
    locale: 'en',
    defaultLocale: 'ar',
    supportedLocales: ['ar', 'en'],
    timeZone: 'Asia/Riyadh',
    today: '2026-11-08',
    weekStart: 7,
    weekendDays: [5, 6],
    numberingSystem: 'latn',
    hourCycle: 'h23',
    phone: '+966 11 000 0000',
    email: 'info@al-noor.example',
    address: '12 Al Noor Street, Building 4',
    about: 'Family medicine and vaccinations for adults and children.',
    directions: 'Bus 12, stop Al Noor Street. Parking behind the building.',
    legalNoticeUrl: 'https://al-noor.example/legal',
    privacyPolicyUrl: 'https://al-noor.example/privacy',
    theme: {
      preset: 'TEAL',
      customColor: null,
      scale: [],
      adjusted: false,
      logoUrl: null,
      initials: 'AN',
    },
    openNow: true,
    nextChangeAt: '2026-11-08T13:00:00.000Z',
    openingHours: WEEKDAY_HOURS,
    specialDays: [
      { date: '2026-11-19', closed: true, opensAt: null, closesAt: null, label: 'Team training' },
    ],
    services: [
      {
        id: '10000000-0000-4000-8000-000000000001',
        name: 'Check-up',
        description: 'Preventive care',
        durationMinutes: 30,
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        name: 'Vaccination',
        description: null,
        durationMinutes: 15,
      },
    ],
    team: [
      {
        id: '20000000-0000-4000-8000-000000000001',
        title: 'Dr.',
        firstName: 'Lina',
        lastName: 'Mansour',
        specialty: 'General practitioner',
        position: null,
        languages: ['ar', 'en'],
        isProvider: true,
        photoUrl: null,
      },
    ],
    ...overrides,
  };
}

const ARABIC_TEXT: Partial<PublicPracticeDto> = {
  locale: 'ar',
  name: 'مركز النور الطبي',
  about: 'طب الأسرة والتطعيمات للكبار والأطفال.',
  address: 'شارع النور ١٢، المبنى ٤',
  directions: 'الحافلة ١٢، محطة شارع النور. موقف خلف المبنى.',
};

const LONG_ARABIC = 'مركز طبي متخصص في طب الأسرة والتطعيمات والتشخيص للكبار والأطفال '.repeat(4);

const THEME = practice({}).theme;

/** Each entry answers for its slug, in the language the request asks for. */
export const PRACTICES: Readonly<Record<string, (language: string) => PublicPracticeDto>> = {
  'al-noor': (language) => practice(language === 'ar' ? ARABIC_TEXT : {}),
  // A retired slug answers with the practice and its current slug.
  'old-name': (language) => practice(language === 'ar' ? ARABIC_TEXT : {}),
  ocean: () => practice({ slug: 'ocean', theme: { ...THEME, preset: 'OCEAN' } }),
  custom: () =>
    practice({
      slug: 'custom',
      theme: {
        ...THEME,
        preset: 'TEAL',
        customColor: '#7a1f5c',
        scale: [
          '#fdf2f9',
          '#fbe6f4',
          '#f6c9e6',
          '#ef9fd2',
          '#e26cb5',
          '#c2428f',
          '#7a1f5c',
          '#651a4c',
          '#54163f',
          '#461335',
          '#2c0921',
        ],
      },
    }),
  hostile: () =>
    practice({
      slug: 'hostile',
      name: '</script><script>window.pwned = true</script>',
      about: '<img src=x onerror="window.pwned = true">',
      legalNoticeUrl: 'javascript:window.pwned = true',
      theme: { ...THEME, scale: Array.from({ length: 11 }, () => '#000;}</style><script>') },
    }),
  'long-arabic': () =>
    practice({
      slug: 'long-arabic',
      locale: 'ar',
      name: LONG_ARABIC.slice(0, 80),
      about: LONG_ARABIC,
      address: LONG_ARABIC,
      directions: LONG_ARABIC,
      services: [
        {
          id: '10000000-0000-4000-8000-000000000003',
          name: LONG_ARABIC.slice(0, 120),
          description: LONG_ARABIC,
          durationMinutes: 45,
        },
      ],
    }),
  closed: () =>
    practice({
      slug: 'closed',
      openNow: false,
      nextChangeAt: '2026-11-09T05:00:00.000Z',
      numberingSystem: 'arab',
    }),
  'no-times': () => practice({ slug: 'no-times' }),
  hidden: () =>
    practice({
      slug: 'hidden',
      openNow: null,
      nextChangeAt: null,
      openingHours: [],
      specialDays: [],
      team: [],
      services: [],
    }),
};

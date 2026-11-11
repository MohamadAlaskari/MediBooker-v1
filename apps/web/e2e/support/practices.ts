/**
 * The practices of the API stub: synthetic, one for each case a page must handle, each with an id of
 * its own. Typed by the generated client, so a change of the contract fails the type check here.
 */
import type { PublicPracticeDto } from '@medibooker/api-client';

function idOf(number: number): string {
  return `40000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
}

export const PRACTICE_ID = idOf(1);
export const OCEAN_ID = idOf(4);
export const ASKS_LITTLE_ID = idOf(5);
const LINDENHOF_ID = idOf(6);

export const SERVICE_ID = '10000000-0000-4000-8000-000000000001';
export const DOCTOR_ID = '20000000-0000-4000-8000-000000000001';

const WEEKDAY_HOURS = [7, 1, 2, 3, 4].map((weekday) => ({
  weekday,
  opensAt: '08:00',
  closesAt: '16:00',
}));

function practice(overrides: Partial<PublicPracticeDto>): PublicPracticeDto {
  return {
    id: PRACTICE_ID,
    insuranceTypes: ['PUBLIC', 'PRIVATE', 'SELF_PAY'],
    insuranceProviderTypes: ['PUBLIC', 'PRIVATE'],
    insuranceNumberTypes: ['PUBLIC', 'PRIVATE'],
    cancellationDeadlineHours: 24,
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
        id: SERVICE_ID,
        name: 'Check-up',
        description: 'Preventive care',
        durationMinutes: 30,
        referralRequired: false,
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        name: 'Vaccination',
        description: null,
        durationMinutes: 15,
        referralRequired: true,
      },
    ],
    team: [
      {
        id: DOCTOR_ID,
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

function textOf(language: string): Partial<PublicPracticeDto> {
  return language === 'ar' ? ARABIC_TEXT : {};
}

const LONG_ARABIC = 'مركز طبي متخصص في طب الأسرة والتطعيمات والتشخيص للكبار والأطفال '.repeat(4);

const THEME = practice({}).theme;

/** Each entry answers for its slug, in the language the request asks for. */
export const PRACTICES: Readonly<Record<string, (language: string) => PublicPracticeDto>> = {
  'al-noor': (language) => practice(textOf(language)),
  // A retired slug answers with the practice and its current slug.
  'old-name': (language) => practice(textOf(language)),
  ocean: (language) =>
    practice({
      ...textOf(language),
      id: OCEAN_ID,
      slug: 'ocean',
      name: language === 'ar' ? 'عيادة المحيط' : 'Ocean Family Clinic',
      theme: { ...THEME, preset: 'OCEAN' },
    }),
  // Takes insurance, and asks for neither a provider nor a number.
  'asks-little': (language) =>
    practice({
      ...textOf(language),
      id: ASKS_LITTLE_ID,
      slug: 'asks-little',
      insuranceProviderTypes: [],
      insuranceNumberTypes: [],
    }),
  // Takes no public insurance: an account on it starts on the first type this practice takes.
  'private-only': (language) =>
    practice({
      ...textOf(language),
      id: idOf(7),
      slug: 'private-only',
      insuranceTypes: ['PRIVATE', 'SELF_PAY'],
      insuranceProviderTypes: ['PRIVATE'],
      insuranceNumberTypes: ['PRIVATE'],
    }),
  // In a market with a format of its own for a public insurance number (BR-10).
  lindenhof: (language) =>
    practice({
      ...textOf(language),
      id: LINDENHOF_ID,
      slug: 'lindenhof',
      name: 'Praxis am Lindenhof',
    }),
  // No doctor has a public profile: an appointment names nobody (BR-24).
  'no-public-doctor': (language) =>
    practice({ ...textOf(language), id: idOf(8), slug: 'no-public-doctor', team: [] }),
  // Without a name in this language: sentences say "a practice", and a fact row goes.
  'no-name': (language) =>
    practice({ ...textOf(language), id: idOf(9), slug: 'no-name', name: null, address: null }),
  // A name longer than a phone's line, in several words and in one.
  'long-name': (language) =>
    practice({
      ...textOf(language),
      id: idOf(10),
      slug: 'long-name',
      name:
        language === 'ar'
          ? 'مركز النور لطب الأسرة والتطعيمات وصحة الأطفال في الرياض'
          : 'Al Noor Centre for Family Medicine and Vaccination in Riyadh',
    }),
  'long-word': (language) =>
    practice({
      ...textOf(language),
      id: idOf(11),
      slug: 'long-word',
      name:
        language === 'ar'
          ? 'مركزالنورلطبالأسرةوالتطعيماتوصحةالأطفالفيالرياضوالمدينة'
          : 'AlNoorCentreForFamilyMedicineAndVaccinationInRiyadh',
    }),
  custom: () =>
    practice({
      id: idOf(12),
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
      id: idOf(13),
      slug: 'hostile',
      name: '</script><script>window.pwned = true</script>',
      about: '<img src=x onerror="window.pwned = true">',
      legalNoticeUrl: 'javascript:window.pwned = true',
      theme: { ...THEME, scale: Array.from({ length: 11 }, () => '#000;}</style><script>') },
    }),
  'long-arabic': () =>
    practice({
      id: idOf(14),
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
          referralRequired: false,
        },
      ],
    }),
  closed: () =>
    practice({
      id: idOf(15),
      slug: 'closed',
      openNow: false,
      nextChangeAt: '2026-11-09T05:00:00.000Z',
      numberingSystem: 'arab',
    }),
  'no-times': () => practice({ id: idOf(16), slug: 'no-times' }),
  hidden: () =>
    practice({
      id: idOf(17),
      slug: 'hidden',
      openNow: null,
      nextChangeAt: null,
      openingHours: [],
      specialDays: [],
      team: [],
      services: [],
    }),
};

/** The name of a service in each language: what an appointment carries. */
export const SERVICE_NAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [SERVICE_ID]: { ar: 'فحص', en: 'Check-up' },
  '10000000-0000-4000-8000-000000000002': { ar: 'تطعيم', en: 'Vaccination' },
};

/** A practice by what the routes of a signed-in person name it by. */
export function practiceById(id: string): ((language: string) => PublicPracticeDto) | undefined {
  return Object.values(PRACTICES).find((answer) => answer('en').id === id);
}

/** Its market decides the format of a number (BR-10); it is not on the public page. */
export function marketOf(id: string): string {
  return id === LINDENHOF_ID ? 'DE' : 'SA';
}

const ISO_FRIDAY = 5;
const ISO_SATURDAY = 6;
const CLOSED_DAY = '2026-11-19';
/** Local 09:00, 09:30 and 16:00 in Riyadh, and only the second for a chosen doctor. */
const TIMES_UTC = ['06:00', '06:30', '13:00'];

/** The times a practice has slots at on a day, taken or not. */
export function startsOn(slug: string, date: string, providerId: string | null): readonly string[] {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const isClosed = weekday === ISO_FRIDAY || weekday === ISO_SATURDAY || date === CLOSED_DAY;
  if (slug === 'no-times' || isClosed) return [];
  const hours = providerId === null ? TIMES_UTC : TIMES_UTC.slice(1, 2);
  return hours.map((time) => `${date}T${time}:00Z`);
}

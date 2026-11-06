import type { PublicPracticeRows } from '../../src/modules/public-practice/public-practice.mapper.js';

const AT = new Date('2026-10-01T08:00:00.000Z');

/** A synthetic practice as the service reads it: Sunday to Thursday, 09:00 to 13:00, in Riyadh. */
export function publicPracticeRows(
  overrides: Partial<PublicPracticeRows> = {},
): PublicPracticeRows {
  return {
    slug: 'al-noor',
    name: { ar: 'مركز النور', en: 'Al Noor Centre' },
    settings: {
      id: 1,
      timeZone: 'Asia/Riyadh',
      defaultLocale: 'ar',
      supportedLocales: ['ar', 'en'],
      weekStart: 7,
      weekendDays: [5, 6],
      numberingSystem: 'latn',
      hourCycle: 'h12',
      phone: '+966 11 000 0000',
      email: 'info@al-noor.example',
      address: { ar: 'الرياض', en: 'Riyadh' },
      maxFutureAppointmentsPerPatient: 2,
      minLeadTimeMinutes: 120,
      maxHorizonDays: 90,
      cancellationDeadlineHours: 24,
      reminderHoursBefore: 24,
      updatedAt: AT,
    },
    page: {
      id: 1,
      about: { ar: 'عن المركز', en: 'About the centre' },
      directions: { ar: 'موقف مجاني', en: 'Free parking' },
      showServices: true,
      showTeam: true,
      showOpeningHours: true,
      showDirections: true,
      legalNoticeUrl: 'https://al-noor.example/legal',
      privacyPolicyUrl: null,
      updatedAt: AT,
    },
    theme: {
      id: 1,
      preset: 'TEAL',
      customColor: null,
      scale: [],
      adjusted: false,
      initials: 'من',
      updatedAt: AT,
    },
    openingHours: [7, 1, 2, 3, 4].map((weekday) => ({
      id: `00000000-0000-4000-8200-00000000000${String(weekday)}`,
      weekday,
      opensAt: 540,
      closesAt: 780,
    })),
    specialDays: [
      {
        id: '00000000-0000-4000-8300-000000000001',
        date: new Date('2026-11-19T00:00:00.000Z'),
        closed: true,
        opensAt: null,
        closesAt: null,
        label: { ar: 'تدريب الفريق', en: 'Team training' },
      },
    ],
    services: [
      {
        id: '00000000-0000-4000-8100-000000000001',
        name: { ar: 'استشارة', en: 'Consultation' },
        description: { ar: 'فحص عام', en: 'A general examination' },
        durationMinutes: 20,
        isBookableOnline: true,
        allowedInsuranceTypes: ['SELF_PAY'],
        active: true,
        sortOrder: 1,
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    team: [
      {
        id: '00000000-0000-4000-8400-000000000001',
        title: 'د.',
        firstName: 'سارة',
        lastName: 'الحربي',
        position: { ar: 'طبيبة أسرة', en: 'Family doctor' },
        isProvider: true,
        specialty: { ar: 'طب الأسرة', en: 'Family medicine' },
        languages: ['ar', 'en'],
        hiddenAt: null,
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    ...overrides,
  };
}

/** Every key of a JSON value, at any depth, with its path: `team[].firstName`. */
export function keyPathsOf(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    const items = value as readonly unknown[];
    return [...new Set(items.flatMap((item) => keyPathsOf(item, `${path}[]`)))].sort();
  }
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value)
    .flatMap(([key, child]) => {
      const childPath = path === '' ? key : `${path}.${key}`;
      return [childPath, ...keyPathsOf(child, childPath)];
    })
    .sort();
}

/** The allowlist of the public response (BR-22, BR-24): a new key is a reviewed change. */
export const PUBLIC_PRACTICE_KEY_PATHS = [
  'about',
  'address',
  'defaultLocale',
  'directions',
  'email',
  'hourCycle',
  'legalNoticeUrl',
  'locale',
  'name',
  'nextChangeAt',
  'numberingSystem',
  'openNow',
  'openingHours',
  'openingHours[].closesAt',
  'openingHours[].opensAt',
  'openingHours[].weekday',
  'phone',
  'privacyPolicyUrl',
  'services',
  'services[].description',
  'services[].durationMinutes',
  'services[].id',
  'services[].name',
  'slug',
  'specialDays',
  'specialDays[].closed',
  'specialDays[].closesAt',
  'specialDays[].date',
  'specialDays[].label',
  'specialDays[].opensAt',
  'supportedLocales',
  'team',
  'team[].firstName',
  'team[].id',
  'team[].isProvider',
  'team[].languages',
  'team[].lastName',
  'team[].photoUrl',
  'team[].position',
  'team[].specialty',
  'team[].title',
  'theme',
  'theme.adjusted',
  'theme.customColor',
  'theme.initials',
  'theme.logoUrl',
  'theme.preset',
  'theme.scale',
  'timeZone',
  'weekStart',
  'weekendDays',
];

/**
 * The synthetic data of the seed practices (02 §9) and how it reaches a practice database. Every
 * name, number and address is invented. Fixed ids, so a repeated fill changes no row.
 */
import type { Client } from 'pg';

type LocaleText = Readonly<Record<string, string>>;

export interface SeedPracticeData {
  readonly settings: {
    readonly weekStart: number;
    readonly weekendDays: readonly number[];
    readonly numberingSystem: 'latn' | 'arab';
    readonly hourCycle: 'h12' | 'h23';
    readonly phone: string;
    readonly email: string;
    readonly address: LocaleText;
  };
  readonly page: { readonly about: LocaleText; readonly directions: LocaleText };
  readonly theme: { readonly preset: string; readonly initials: string };
  readonly openingHours: readonly {
    readonly id: string;
    readonly weekday: number;
    readonly opensAt: number;
    readonly closesAt: number;
  }[];
  readonly specialDays: readonly {
    readonly id: string;
    readonly date: string;
    readonly closed: boolean;
    readonly opensAt?: number;
    readonly closesAt?: number;
    readonly label: LocaleText;
  }[];
  readonly services: readonly {
    readonly id: string;
    readonly name: LocaleText;
    readonly description: LocaleText;
    readonly durationMinutes: number;
    readonly isBookableOnline?: boolean;
    readonly active?: boolean;
    readonly sortOrder: number;
  }[];
  readonly staff: readonly {
    readonly id: string;
    readonly title?: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly position: LocaleText;
    readonly isProvider: boolean;
    readonly specialty: LocaleText;
    readonly languages: readonly string[];
    readonly hiddenAt?: string;
    readonly consents: readonly {
      readonly id: string;
      readonly type: 'PHOTO' | 'PUBLIC_PROFILE';
      readonly givenAt: string;
      readonly withdrawnAt?: string;
    }[];
  }[];
}

/** A fixed id: the practice's number, the kind of row and a running number. */
function rowId(practice: number, kind: number, row: number): string {
  return `0000000${String(practice)}-0000-4000-8${String(kind)}00-${String(row).padStart(12, '0')}`;
}

const SERVICE = 1;
const OPENING_HOURS = 2;
const SPECIAL_DAY = 3;
const STAFF = 4;
const CONSENT = 5;

const CONSENT_GIVEN_AT = '2026-10-01T08:00:00.000Z';

/** Sunday to Thursday, 09:00 to 13:00 and 16:00 to 20:00. */
const AL_NOOR_HOURS = [7, 1, 2, 3, 4].flatMap((weekday, day) => [
  { id: rowId(1, OPENING_HOURS, day * 2 + 1), weekday, opensAt: 540, closesAt: 780 },
  { id: rowId(1, OPENING_HOURS, day * 2 + 2), weekday, opensAt: 960, closesAt: 1200 },
]);

/** Monday to Friday, 08:00 to 12:00 and 14:00 to 18:00. */
const LINDENHOF_HOURS = [1, 2, 3, 4, 5].flatMap((weekday, day) => [
  { id: rowId(2, OPENING_HOURS, day * 2 + 1), weekday, opensAt: 480, closesAt: 720 },
  { id: rowId(2, OPENING_HOURS, day * 2 + 2), weekday, opensAt: 840, closesAt: 1080 },
]);

const AL_NOOR_DATA: SeedPracticeData = {
  settings: {
    weekStart: 7,
    weekendDays: [5, 6],
    numberingSystem: 'latn',
    hourCycle: 'h12',
    phone: '+966 11 000 0000',
    email: 'info@al-noor.example',
    address: {
      ar: 'شارع الورود 12، الرياض',
      en: '12 Al Wurud Street, Riyadh',
    },
  },
  page: {
    about: {
      ar: 'مركز طبي للعائلة يقدم الرعاية العامة والمتابعة والتطعيمات.',
      en: 'A family medical centre for general care, follow-ups and vaccinations.',
    },
    directions: {
      ar: 'مواقف مجانية خلف المبنى، والمدخل مناسب للكراسي المتحركة.',
      en: 'Free parking behind the building; the entrance is wheelchair accessible.',
    },
  },
  theme: { preset: 'TEAL', initials: 'من' },
  openingHours: AL_NOOR_HOURS,
  specialDays: [
    {
      id: rowId(1, SPECIAL_DAY, 1),
      date: '2026-11-19',
      closed: true,
      label: { ar: 'تدريب الفريق', en: 'Team training' },
    },
  ],
  services: [
    {
      id: rowId(1, SERVICE, 1),
      name: { ar: 'استشارة عامة', en: 'General consultation' },
      description: { ar: 'فحص وتقييم عام', en: 'A general examination and assessment' },
      durationMinutes: 20,
      sortOrder: 1,
    },
    {
      id: rowId(1, SERVICE, 2),
      name: { ar: 'موعد متابعة', en: 'Follow-up visit' },
      description: { ar: 'متابعة بعد زيارة سابقة', en: 'After an earlier visit' },
      durationMinutes: 15,
      sortOrder: 2,
    },
    {
      id: rowId(1, SERVICE, 3),
      name: { ar: 'تطعيم', en: 'Vaccination' },
      description: { ar: 'تطعيمات للكبار والأطفال', en: 'For adults and children' },
      durationMinutes: 10,
      sortOrder: 3,
    },
    {
      id: rowId(1, SERVICE, 4),
      name: { ar: 'إجراء بسيط', en: 'Minor procedure' },
      description: { ar: 'يحجز عبر العيادة فقط', en: 'Booked through the practice only' },
      durationMinutes: 45,
      isBookableOnline: false,
      sortOrder: 4,
    },
  ],
  staff: [
    {
      id: rowId(1, STAFF, 1),
      title: 'د.',
      firstName: 'سارة',
      lastName: 'الحربي',
      position: { ar: 'طبيبة أسرة', en: 'Family doctor' },
      isProvider: true,
      specialty: { ar: 'طب الأسرة', en: 'Family medicine' },
      languages: ['ar', 'en'],
      consents: [{ id: rowId(1, CONSENT, 1), type: 'PUBLIC_PROFILE', givenAt: CONSENT_GIVEN_AT }],
    },
    {
      id: rowId(1, STAFF, 2),
      title: 'د.',
      firstName: 'عمر',
      lastName: 'خليل',
      position: { ar: 'طبيب باطنة', en: 'Internist' },
      isProvider: true,
      specialty: { ar: 'الطب الباطني', en: 'Internal medicine' },
      languages: ['ar'],
      // Withdrawn: the public page must not list this person (BR-24).
      consents: [
        {
          id: rowId(1, CONSENT, 2),
          type: 'PUBLIC_PROFILE',
          givenAt: CONSENT_GIVEN_AT,
          withdrawnAt: '2026-10-15T08:00:00.000Z',
        },
      ],
    },
    {
      id: rowId(1, STAFF, 3),
      firstName: 'لينا',
      lastName: 'حداد',
      position: { ar: 'مساعدة طبية', en: 'Medical assistant' },
      isProvider: false,
      specialty: {},
      languages: ['ar', 'en'],
      // No consent at all: not listed either.
      consents: [],
    },
  ],
};

const LINDENHOF_DATA: SeedPracticeData = {
  settings: {
    weekStart: 1,
    weekendDays: [6, 7],
    numberingSystem: 'latn',
    hourCycle: 'h23',
    phone: '+49 30 0000000',
    email: 'praxis@lindenhof.example',
    address: {
      ar: 'شارع ليندن 5، برلين',
      en: 'Lindenstraße 5, Berlin',
    },
  },
  page: {
    about: {
      ar: 'عيادة عامة في وسط المدينة.',
      en: 'A general practice in the city centre.',
    },
    directions: {
      ar: 'بالقرب من محطة المترو.',
      en: 'Close to the underground station.',
    },
  },
  theme: { preset: 'OCEAN', initials: 'LH' },
  openingHours: LINDENHOF_HOURS,
  specialDays: [
    {
      id: rowId(2, SPECIAL_DAY, 1),
      date: '2026-12-24',
      closed: false,
      opensAt: 480,
      closesAt: 720,
      label: { ar: 'ساعات مختصرة', en: 'Short hours' },
    },
  ],
  services: [
    {
      id: rowId(2, SERVICE, 1),
      name: { ar: 'فحص دوري', en: 'Check-up' },
      description: { ar: 'فحص شامل', en: 'A full check-up' },
      durationMinutes: 30,
      sortOrder: 1,
    },
    {
      id: rowId(2, SERVICE, 2),
      name: { ar: 'تطعيم الإنفلونزا', en: 'Flu vaccination' },
      description: { ar: 'تطعيم موسمي', en: 'Seasonal vaccination' },
      durationMinutes: 10,
      sortOrder: 2,
    },
  ],
  staff: [
    {
      id: rowId(2, STAFF, 1),
      title: 'Dr.',
      firstName: 'Anna',
      lastName: 'Weber',
      position: { ar: 'طبيبة عامة', en: 'General practitioner' },
      isProvider: true,
      specialty: { ar: 'الطب العام', en: 'General medicine' },
      languages: ['de', 'en'],
      consents: [{ id: rowId(2, CONSENT, 1), type: 'PUBLIC_PROFILE', givenAt: CONSENT_GIVEN_AT }],
    },
    {
      id: rowId(2, STAFF, 2),
      title: 'Dr.',
      firstName: 'Jonas',
      lastName: 'Keller',
      position: { ar: 'طبيب عام', en: 'General practitioner' },
      isProvider: true,
      specialty: { ar: 'الطب العام', en: 'General medicine' },
      languages: ['de'],
      // Hidden by an admin despite the consent: not listed (BR-24).
      hiddenAt: '2026-10-20T08:00:00.000Z',
      consents: [{ id: rowId(2, CONSENT, 2), type: 'PUBLIC_PROFILE', givenAt: CONSENT_GIVEN_AT }],
    },
  ],
};

/**
 * The seed practices of 02 §9: `al-noor` in Riyadh (no DST, Friday and Saturday weekend) and
 * `lindenhof` in Berlin (DST).
 */
export const SEED_PRACTICES = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'al-noor',
    market: 'SA',
    timeZone: 'Asia/Riyadh',
    defaultLocale: 'ar',
    name: { ar: 'مركز النور الطبي', en: 'Al Noor Medical Centre' },
    data: AL_NOOR_DATA,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    slug: 'lindenhof',
    market: 'DE',
    timeZone: 'Europe/Berlin',
    defaultLocale: 'en',
    name: { ar: 'عيادة ليندنهوف', en: 'Lindenhof Practice' },
    data: LINDENHOF_DATA,
  },
] as const;

/**
 * Writes a practice's data on a connection to its database, in one transaction: the singleton rows
 * the migration inserted, then the rows with fixed ids, which a repeated fill leaves as they are.
 */
export async function fillPractice(client: Client, data: SeedPracticeData): Promise<void> {
  await client.query('BEGIN');
  try {
    const { settings, page, theme } = data;
    await client.query(
      `UPDATE practice_settings SET week_start = $1, weekend_days = $2, numbering_system = $3,
         hour_cycle = $4, phone = $5, email = $6, address = $7 WHERE id = 1`,
      [
        settings.weekStart,
        settings.weekendDays,
        settings.numberingSystem,
        settings.hourCycle,
        settings.phone,
        settings.email,
        settings.address,
      ],
    );
    await client.query('UPDATE practice_pages SET about = $1, directions = $2 WHERE id = 1', [
      page.about,
      page.directions,
    ]);
    await client.query(
      'UPDATE practice_themes SET preset = $1::theme_preset, initials = $2 WHERE id = 1',
      [theme.preset, theme.initials],
    );
    for (const row of data.openingHours) {
      await client.query(
        `INSERT INTO opening_hours (id, weekday, opens_at, closes_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [row.id, row.weekday, row.opensAt, row.closesAt],
      );
    }
    for (const row of data.specialDays) {
      await client.query(
        `INSERT INTO special_days (id, date, closed, opens_at, closes_at, label)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [row.id, row.date, row.closed, row.opensAt ?? null, row.closesAt ?? null, row.label],
      );
    }
    for (const row of data.services) {
      await client.query(
        `INSERT INTO services
           (id, name, description, duration_minutes, is_bookable_online, active, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [
          row.id,
          row.name,
          row.description,
          row.durationMinutes,
          row.isBookableOnline ?? true,
          row.active ?? true,
          row.sortOrder,
        ],
      );
    }
    for (const member of data.staff) {
      await client.query(
        `INSERT INTO staff_members (id, title, first_name, last_name, position, is_provider,
           specialty, languages, hidden_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
        [
          member.id,
          member.title ?? null,
          member.firstName,
          member.lastName,
          member.position,
          member.isProvider,
          member.specialty,
          member.languages,
          member.hiddenAt ?? null,
        ],
      );
      for (const consent of member.consents) {
        await client.query(
          `INSERT INTO staff_consents
             (id, staff_member_id, type, text_version, given_at, withdrawn_at)
           VALUES ($1, $2, $3::staff_consent_type, 'v1', $4, $5) ON CONFLICT DO NOTHING`,
          [consent.id, member.id, consent.type, consent.givenAt, consent.withdrawnAt ?? null],
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

import { describe, expect, it } from 'vitest';
import { commandName, parseCommandLine } from './argv.ts';

const ID = '00000000-0000-4000-8000-000000000001';

describe('parseCommandLine', () => {
  it.each([
    [['migrate', 'platform'], { kind: 'migrate', target: 'platform', practiceId: undefined }],
    [['migrate', 'all'], { kind: 'migrate', target: 'all', practiceId: undefined }],
    [['migrate', 'practices'], { kind: 'migrate', target: 'practices', practiceId: undefined }],
    [
      ['migrate', 'practices', '--practice', ID.toUpperCase()],
      { kind: 'migrate', target: 'practices', practiceId: ID },
    ],
    [
      ['provision', ID, '--market', 'SA'],
      { kind: 'provision', practiceId: ID, market: 'SA', clusterId: undefined },
    ],
    [
      ['provision', ID, '--cluster=eu-1', '--market=DE'],
      { kind: 'provision', practiceId: ID, market: 'DE', clusterId: 'eu-1' },
    ],
    [
      ['provision', ID, '--market', 'SA', '--time-zone', 'Asia/Riyadh', '--default-locale', 'ar'],
      {
        kind: 'provision',
        practiceId: ID,
        market: 'SA',
        clusterId: undefined,
        timeZone: 'Asia/Riyadh',
        defaultLocale: 'ar',
      },
    ],
    [
      [
        'practice',
        'create',
        '--slug',
        'al-shifa',
        '--name-ar',
        'عيادة الشفاء',
        '--name-en',
        'Al Shifa Clinic',
        '--market',
        'SA',
        '--time-zone',
        'Asia/Riyadh',
        '--default-locale',
        'ar',
      ],
      {
        kind: 'practice-create',
        slug: 'al-shifa',
        names: { ar: 'عيادة الشفاء', en: 'Al Shifa Clinic' },
        market: 'SA',
        clusterId: undefined,
        timeZone: 'Asia/Riyadh',
        defaultLocale: 'ar',
      },
    ],
    [
      ['practice', 'create', '--slug=x', '--name-ar=a', '--name-en=b', '--market=DE'],
      {
        kind: 'practice-create',
        slug: 'x',
        names: { ar: 'a', en: 'b' },
        market: 'DE',
        clusterId: undefined,
        timeZone: undefined,
        defaultLocale: undefined,
      },
    ],
    [['verify'], { kind: 'verify', practiceId: undefined }],
    [['verify', '--practice', ID], { kind: 'verify', practiceId: ID }],
    [['roles', 'reconcile'], { kind: 'roles-reconcile', practiceId: undefined }],
    [['roles', 'reconcile', '--practice', ID], { kind: 'roles-reconcile', practiceId: ID }],
    [['reset-local'], { kind: 'reset-local' }],
  ])('parses %j', (args, expected) => {
    expect(parseCommandLine(args)).toEqual(expected);
  });

  it.each([
    [[]],
    [['migrate']],
    [['migrate', 'everything']],
    [['migrate', 'platform', '--practice', ID]],
    [['migrate', 'all', '--practice', ID]],
    [['migrate', 'practices', 'extra']],
    [['migrate', 'practices', '--practice', 'not-a-uuid']],
    [['migrate', 'practices', '--practice']],
    [['provision', ID]],
    [['provision', 'not-a-uuid', '--market', 'SA']],
    [['provision', ID, '--market', 'sa']],
    [['provision', ID, '--market', 'SAU']],
    [['provision', ID, '--market', 'SA', '--cluster', 'Bad_Cluster']],
    [['provision', ID, '--market', 'SA', '--practice', ID]],
    [['provision', ID, '--market', 'SA', '--time-zone', 'Not/AZone']],
    [['provision', ID, '--market', 'SA', '--default-locale', 'Arabic']],
    [['practice', 'create', '--slug', 'a-b', '--name-ar', 'أ', '--name-en', 'A']],
    [['practice', 'create', '--name-ar', 'أ', '--name-en', 'A', '--market', 'SA']],
    [['practice', 'create', '--slug', 'a-b', '--name-en', 'A', '--market', 'SA']],
    [['practice', 'create', '--slug', 'a-b', '--name-ar', 'أ', '--name-en', 'A', '--market', 'sa']],
    [
      [
        'practice',
        'create',
        '--slug',
        'a-b',
        '--name-ar',
        'أ',
        '--name-en',
        'A',
        '--market',
        'SA',
        '--practice',
        ID,
      ],
    ],
    [
      [
        'practice',
        'create',
        '--slug',
        'a-b',
        '--name-ar',
        'أ',
        '--name-en',
        'A',
        '--market',
        'SA',
        '--time-zone',
        'Mars/Base',
      ],
    ],
    [['practice', 'remove', '--slug', 'a-b']],
    [
      [
        'practice',
        'create',
        'extra',
        '--slug',
        'a-b',
        '--name-ar',
        'أ',
        '--name-en',
        'A',
        '--market',
        'SA',
      ],
    ],
    [['verify', 'now']],
    [['verify', '--market', 'SA']],
    [['roles']],
    [['roles', 'reconcile', 'all']],
    [['reset-local', '--practice', ID]],
    [['reset-local', '--force']],
    [['help']],
  ])('rejects %j', (args) => {
    expect(parseCommandLine(args)).toBeUndefined();
  });
});

describe('commandName', () => {
  it('names each command as the output shows it', () => {
    expect(commandName({ kind: 'migrate', target: 'practices', practiceId: undefined })).toBe(
      'migrate practices',
    );
    expect(commandName({ kind: 'roles-reconcile', practiceId: undefined })).toBe('roles reconcile');
    expect(commandName({ kind: 'reset-local' })).toBe('reset-local');
    expect(
      commandName({
        kind: 'provision',
        practiceId: ID,
        market: 'SA',
        clusterId: undefined,
        timeZone: undefined,
        defaultLocale: undefined,
      }),
    ).toBe('provision');
    expect(commandName({ kind: 'verify', practiceId: undefined })).toBe('verify');
    expect(
      commandName({
        kind: 'practice-create',
        slug: 'al-shifa',
        names: { ar: 'عيادة الشفاء', en: 'Al Shifa Clinic' },
        market: 'SA',
        clusterId: undefined,
        timeZone: undefined,
        defaultLocale: undefined,
      }),
    ).toBe('practice create');
  });
});

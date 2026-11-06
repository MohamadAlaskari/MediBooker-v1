import { describe, expect, it } from 'vitest';
import {
  keyPathsOf,
  PUBLIC_PRACTICE_KEY_PATHS,
  publicPracticeRows,
} from '../../../test/support/public-practice-rows.js';
import { clockOf, toPublicPractice } from './public-practice.mapper.js';

/** Sunday 2026-11-15, 10:00 in Riyadh. */
const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');

describe('toPublicPractice (BR-22, BR-24)', () => {
  it('returns exactly the allowlisted fields, whatever the rows hold', () => {
    const practice = toPublicPractice(publicPracticeRows(), NOW, undefined);
    expect(keyPathsOf(practice)).toEqual(PUBLIC_PRACTICE_KEY_PATHS);
  });

  it('keeps the booking parameters, insurance types and row timestamps inside the API', () => {
    const text = JSON.stringify(toPublicPractice(publicPracticeRows(), NOW, undefined));
    for (const hidden of ['maxHorizonDays', 'allowedInsuranceTypes', 'updatedAt', 'hiddenAt']) {
      expect(text).not.toContain(hidden);
    }
  });

  it('answers in the default locale without a language, and in English when asked', () => {
    const arabic = toPublicPractice(publicPracticeRows(), NOW, undefined);
    expect(arabic).toMatchObject({ locale: 'ar', name: 'مركز النور', about: 'عن المركز' });
    const english = toPublicPractice(publicPracticeRows(), NOW, 'en-GB,en;q=0.9');
    expect(english).toMatchObject({
      locale: 'en',
      name: 'Al Noor Centre',
      about: 'About the centre',
      address: 'Riyadh',
      directions: 'Free parking',
    });
    expect(english.services[0]?.name).toBe('Consultation');
    expect(english.team[0]?.specialty).toBe('Family medicine');
    expect(english.specialDays[0]?.label).toBe('Team training');
  });

  it('falls back to the default locale for a text without a translation', () => {
    const rows = publicPracticeRows({ name: { ar: 'مركز النور' } });
    expect(toPublicPractice(rows, NOW, 'en').name).toBe('مركز النور');
  });

  it('computes open now in the practice zone and gives times on the wall clock', () => {
    const practice = toPublicPractice(publicPracticeRows(), NOW, undefined);
    expect(practice.openNow).toBe(true);
    expect(practice.nextChangeAt).toBe('2026-11-15T10:00:00Z');
    expect(practice.openingHours[0]).toEqual({ weekday: 1, opensAt: '09:00', closesAt: '13:00' });
    expect(practice.specialDays[0]).toEqual({
      date: '2026-11-19',
      closed: true,
      opensAt: null,
      closesAt: null,
      label: 'تدريب الفريق',
    });
  });

  it('respects a special day when it computes open now', () => {
    // Thursday 2026-11-19, 10:00 in Riyadh: closed for team training.
    const closed = toPublicPractice(
      publicPracticeRows(),
      Temporal.Instant.from('2026-11-19T07:00:00Z'),
      undefined,
    );
    expect(closed.openNow).toBe(false);
  });

  it('hides each section the practice switched off', () => {
    const rows = publicPracticeRows();
    const practice = toPublicPractice(
      {
        ...rows,
        page: {
          ...rows.page,
          showServices: false,
          showTeam: false,
          showOpeningHours: false,
          showDirections: false,
        },
      },
      NOW,
      undefined,
    );
    expect(practice).toMatchObject({
      services: [],
      team: [],
      openingHours: [],
      specialDays: [],
      openNow: null,
      nextChangeAt: null,
      directions: null,
    });
  });

  it('never returns a photo: R02 stores them, with their own consent', () => {
    expect(toPublicPractice(publicPracticeRows(), NOW, undefined).team[0]?.photoUrl).toBeNull();
  });

  it('sorts the team by last name in the locale of the response', () => {
    const rows = publicPracticeRows();
    const [member] = rows.team;
    if (member === undefined) throw new Error('fixture without a team member');
    const team = [
      { ...member, id: 'b', lastName: 'Weber' },
      { ...member, id: 'a', lastName: 'Adler' },
    ];
    const practice = toPublicPractice({ ...rows, team }, NOW, 'en');
    expect(practice.team.map((each) => each.id)).toEqual(['a', 'b']);
  });
});

describe('clockOf', () => {
  it.each([
    [0, '00:00'],
    [540, '09:00'],
    [965, '16:05'],
    [1440, '24:00'],
  ])('writes %i minutes as %s', (minutes, clock) => {
    expect(clockOf(minutes)).toBe(clock);
  });
});

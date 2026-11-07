import { describe, expect, it } from 'vitest';
import { bookableWindow } from '../../scheduling/domain/slots.rules.js';
import {
  hasBookingPlace,
  isInBookingWindow,
  isProfileComplete,
  isServiceBookable,
} from './booking.rules.js';

const SERVICE = { active: true, isBookableOnline: true, allowedInsuranceTypes: [] };
const INSURANCE_RULES = {
  insuranceTypes: ['PUBLIC', 'SELF_PAY'],
  insuranceProviderTypes: ['PUBLIC'],
  insuranceNumberTypes: ['PUBLIC'],
};

describe('isProfileComplete (BR-09, BR-10)', () => {
  const complete = { type: 'PUBLIC', provider: 'Synthetic', numberKnown: true } as const;

  it('takes a profile that meets what the practice asks today', () => {
    expect(isProfileComplete(INSURANCE_RULES, 'DE', complete)).toBe(true);
    expect(
      isProfileComplete(INSURANCE_RULES, 'DE', {
        type: 'SELF_PAY',
        provider: null,
        numberKnown: false,
      }),
    ).toBe(true);
  });

  it('refuses a type the practice no longer takes, or what it now asks for', () => {
    expect(isProfileComplete(INSURANCE_RULES, 'DE', { ...complete, type: 'PRIVATE' })).toBe(false);
    expect(isProfileComplete(INSURANCE_RULES, 'DE', { ...complete, provider: null })).toBe(false);
    expect(isProfileComplete(INSURANCE_RULES, 'DE', { ...complete, numberKnown: false })).toBe(
      false,
    );
  });
});

describe('isServiceBookable (BR-08)', () => {
  it('takes an active service that can be booked online, for every type when it names none', () => {
    expect(isServiceBookable(SERVICE, 'PUBLIC')).toBe(true);
    expect(isServiceBookable(SERVICE, 'SELF_PAY')).toBe(true);
  });

  it('takes only the types a service names', () => {
    const service = { ...SERVICE, allowedInsuranceTypes: ['SELF_PAY'] };
    expect(isServiceBookable(service, 'SELF_PAY')).toBe(true);
    expect(isServiceBookable(service, 'PUBLIC')).toBe(false);
  });

  it('refuses a service that is not active or not online', () => {
    expect(isServiceBookable({ ...SERVICE, active: false }, 'PUBLIC')).toBe(false);
    expect(isServiceBookable({ ...SERVICE, isBookableOnline: false }, 'PUBLIC')).toBe(false);
  });
});

describe('isInBookingWindow (BR-03)', () => {
  const NOW = Temporal.Instant.from('2026-11-15T07:00:00Z');
  const WINDOW = bookableWindow(NOW, { minLeadTimeMinutes: 120, maxHorizonDays: 90 });

  it.each([
    ['one minute before the lead time', WINDOW.earliest.subtract({ minutes: 1 }), false],
    ['at the lead time', WINDOW.earliest, true],
    ['one minute after the lead time', WINDOW.earliest.add({ minutes: 1 }), true],
    ['one minute before the horizon', WINDOW.latest.subtract({ minutes: 1 }), true],
    ['at the horizon', WINDOW.latest, true],
    ['one minute after the horizon', WINDOW.latest.add({ minutes: 1 }), false],
    ['in the past', NOW.subtract({ hours: 1 }), false],
  ])('%s', (_, startsAt, expected) => {
    expect(isInBookingWindow(startsAt, WINDOW)).toBe(expected);
  });

  it('counts elapsed time across the spring gap, not the wall clock', () => {
    // 01:30 in Berlin on the night the clocks jump from 02:00 to 03:00. Two hours later it is 04:30.
    const now = Temporal.Instant.from('2027-03-28T00:30:00Z');
    const window = bookableWindow(now, { minLeadTimeMinutes: 120, maxHorizonDays: 90 });
    const earliest = Temporal.ZonedDateTime.from('2027-03-28T04:30:00+02:00[Europe/Berlin]');
    expect(isInBookingWindow(earliest.toInstant(), window)).toBe(true);
    expect(isInBookingWindow(earliest.subtract({ minutes: 1 }).toInstant(), window)).toBe(false);
  });
});

describe('hasBookingPlace (BR-02)', () => {
  it('leaves a place below the limit, and none at it', () => {
    expect(hasBookingPlace(1, 2)).toBe(true);
    expect(hasBookingPlace(2, 2)).toBe(false);
    expect(hasBookingPlace(3, 2)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { signInAgainHref } from './session-redirect';

const BOOKING = '%2Fen%2Fbook%2Fal-noor';

describe('signInAgainHref', () => {
  it('comes back to the page the person was on', () => {
    expect(signInAgainHref('en', { pathname: '/en/appointments', hash: '' })).toBe(
      '/en/sign-in#next=%2Fen%2Fappointments',
    );
  });

  it('keeps the way back the page already holds', () => {
    expect(signInAgainHref('en', { pathname: '/en/check-inbox', hash: `#next=${BOOKING}` })).toBe(
      `/en/sign-in#next=${BOOKING}`,
    );
  });

  it('signs in in the language of the page, whatever the way back says', () => {
    expect(signInAgainHref('ar', { pathname: '/ar/check-inbox', hash: `#next=${BOOKING}` })).toBe(
      `/ar/sign-in#next=${BOOKING}`,
    );
  });

  it.each(['#next=%2F%2Fevil.example', '#next=https%3A%2F%2Fevil.example', '#main', '#token=abc'])(
    'takes nothing else from the fragment: %s',
    (hash) => {
      expect(signInAgainHref('en', { pathname: '/en/account', hash })).toBe(
        '/en/sign-in#next=%2Fen%2Faccount',
      );
    },
  );
});

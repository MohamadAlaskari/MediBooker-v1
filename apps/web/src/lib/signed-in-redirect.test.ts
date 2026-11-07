import { describe, expect, it } from 'vitest';
import { signInRedirect } from './signed-in-redirect';

describe('signInRedirect', () => {
  it('sends a visitor without a sign-in to it, with the way back in the fragment', () => {
    expect(signInRedirect('/en/account', false)).toEqual({
      pathname: '/en/sign-in',
      hash: 'next=%2Fen%2Faccount',
    });
    expect(signInRedirect('/ar/account/details', false)).toEqual({
      pathname: '/ar/sign-in',
      hash: 'next=%2Far%2Faccount%2Fdetails',
    });
    expect(signInRedirect('/ar/sign-up/details', false)).toEqual({
      pathname: '/ar/sign-in',
      hash: 'next=%2Far%2Fsign-up%2Fdetails',
    });
  });

  it('asks the same for the portal: the appointments and a booking', () => {
    expect(signInRedirect('/en/appointments', false)?.pathname).toBe('/en/sign-in');
    expect(signInRedirect('/en/appointments/a-b/c-d/reschedule', false)?.pathname).toBe(
      '/en/sign-in',
    );
    expect(signInRedirect('/en/book/al-noor', false)).toEqual({
      pathname: '/en/sign-in',
      hash: 'next=%2Fen%2Fbook%2Fal-noor',
    });
    // A practice's own page stays public, also one called like the portal's first segment.
    expect(signInRedirect('/en/book', false)).toBeUndefined();
    expect(signInRedirect('/en/al-noor', false)).toBeUndefined();
  });

  it('leaves someone with a sign-in alone: the API decides about the rest', () => {
    expect(signInRedirect('/en/account', true)).toBeUndefined();
  });

  it('leaves every other page alone', () => {
    for (const path of [
      '/en',
      '/en/sign-in',
      '/en/sign-up',
      '/en/al-noor',
      '/en/accounting',
      '/xx/account',
    ]) {
      expect(signInRedirect(path, false)).toBeUndefined();
    }
  });
});

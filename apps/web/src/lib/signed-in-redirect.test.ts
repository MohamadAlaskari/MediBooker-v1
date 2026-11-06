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

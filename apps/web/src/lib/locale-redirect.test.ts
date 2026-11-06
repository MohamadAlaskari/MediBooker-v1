import { describe, expect, it } from 'vitest';
import { localeRedirectPath } from './locale-redirect';

describe('localeRedirectPath (03 §4)', () => {
  it.each([
    ['/', null, '/ar'],
    ['/', 'en', '/en'],
    ['/', 'en-US,en;q=0.9,ar;q=0.8', '/en'],
    ['/', 'de', '/ar'],
    ['/al-noor', 'en', '/en/al-noor'],
    ['/al-noor/team', null, '/ar/al-noor/team'],
  ])('sends %s with %s to %s', (pathname, acceptLanguage, target) => {
    expect(localeRedirectPath(pathname, acceptLanguage)).toBe(target);
  });

  it.each(['/ar', '/en', '/ar/al-noor', '/de', '/de/al-noor'])(
    'leaves %s to the routes: a locale, or a language that answers 404',
    (pathname) => {
      expect(localeRedirectPath(pathname, 'en')).toBeUndefined();
    },
  );
});

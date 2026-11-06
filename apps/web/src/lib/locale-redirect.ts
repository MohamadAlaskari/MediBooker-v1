import { negotiateLocale, type Locale } from '@medibooker/i18n';

/** A first path segment in the form of a language: `/de` is a language we lack, not a page. */
const LANGUAGE_SEGMENT = /^[a-z]{2}$/;

/**
 * Where a path without a locale goes (03 §4): the same path under the visitor's language, or
 * undefined for a path that already has a locale, or a language segment that `[locale]` answers
 * with 404.
 */
export function localeRedirectPath(
  pathname: string,
  acceptLanguage: string | null,
): `/${Locale}${string}` | undefined {
  const [, first = ''] = pathname.split('/');
  if (LANGUAGE_SEGMENT.test(first)) return undefined;
  const path = pathname === '/' ? '' : pathname;
  return `/${negotiateLocale(acceptLanguage)}${path}`;
}

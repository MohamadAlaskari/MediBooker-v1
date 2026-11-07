import { safeReturnPath } from '@/lib/safe-return-path';

/**
 * Where a session that is over leads: to signing in, and back to this page after it. A way back this
 * page already holds stays, because this page was only a stop on it: the e-mail step of a booking.
 */
export function signInAgainHref(
  locale: string,
  { pathname, hash }: Pick<Location, 'pathname' | 'hash'>,
): string {
  const kept = safeReturnPath(new URLSearchParams(hash.slice(1)).get('next'));
  return `/${locale}/sign-in#next=${encodeURIComponent(kept ?? pathname)}`;
}

/** A new document: nothing of this person stays in memory for whoever signs in now. */
export function signInAgain(locale: string): void {
  window.location.replace(signInAgainHref(locale, window.location));
}

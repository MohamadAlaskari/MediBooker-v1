import { isLocale } from '@medibooker/i18n';

const SIGNED_IN_PAGE =
  /^\/([a-zA-Z-]+)\/(?:account(?:\/[a-z0-9-]*)*|appointments(?:\/[a-z0-9-]*)*|book\/[a-z0-9-]+|sign-up\/details)$/;

export interface SignInRedirect {
  readonly pathname: string;
  readonly hash: string;
}

/**
 * Where a page for signed-in people sends a visitor without a sign-in, with the way back in the
 * fragment, or undefined when it does not. The cookie is only a hint and protects nothing: the API
 * decides about every request, so this only saves a visitor the empty page.
 */
export function signInRedirect(
  pathname: string,
  hasSessionHint: boolean,
): SignInRedirect | undefined {
  if (hasSessionHint) return undefined;
  const locale = SIGNED_IN_PAGE.exec(pathname)?.[1];
  if (locale === undefined || !isLocale(locale)) return undefined;
  return {
    pathname: `/${locale}/sign-in`,
    hash: `next=${encodeURIComponent(pathname)}`,
  };
}

import { isLocale } from '@medibooker/i18n';

const MAX_LENGTH = 512;
const PATH = /^\/([a-zA-Z-]+)((?:\/[a-z0-9-]+)*)\/?$/;

/**
 * A path a page may send a visitor to after signing in, or undefined (03 §7): a page of this site
 * and nothing else, so `//evil.example`, `/\evil.example`, an encoded slash, a URL scheme and a
 * query never get through. It proves the same site, not the same practice: what follows sign-in
 * checks everything again.
 */
export function safeReturnPath(next: string | null | undefined): string | undefined {
  if (next === null || next === undefined || next.length > MAX_LENGTH) return undefined;
  const locale = PATH.exec(next)?.[1];
  return locale !== undefined && isLocale(locale) ? next : undefined;
}

/** The same page in another language: a safe path starts with its locale. */
export function inLocale(path: string, locale: string): string {
  return path.replace(/^\/[^/]+/, `/${locale}`);
}

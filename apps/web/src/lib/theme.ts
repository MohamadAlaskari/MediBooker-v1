/**
 * `data-theme` of every page (03 §6): the visitor's system, or a choice a signed-in person made in
 * their settings, which a `theme` cookie keeps, so that the server renders it without a flash. Only
 * a signed-in area writes the cookie; a public page reads it and sets none.
 */
export const THEMES = ['system', 'light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = 'theme';

/** A year: a setting of a person, not of a session. */
const THEME_COOKIE_SECONDS = 31_536_000;

/** Whatever a cookie or an attribute holds: one of the three, and the system's otherwise. */
export function themeOf(value: string | null | undefined): Theme {
  return THEMES.find((theme) => theme === value) ?? 'system';
}

/** The cookie that keeps a choice: for every path of the site, never sent to another one. */
export function themeCookie(theme: Theme, secure: boolean): string {
  return [
    `${THEME_COOKIE}=${theme}`,
    'Path=/',
    `Max-Age=${String(THEME_COOKIE_SECONDS)}`,
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

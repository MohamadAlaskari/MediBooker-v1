/** Pure. */

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bMediBooker\//, 'MediBooker App'],
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

/** In this order: an iPad and an Android phone also name the systems below them. */
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\b(?:Macintosh|Mac OS X)\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

/** How long a User-Agent is read at most: a longer one is cut, never parsed to its end. */
const MAX_USER_AGENT = 512;

/**
 * What signed in, as the session list and the "new sign-in" e-mail (E10) name it: the browser or the
 * app, and the system, for example `Chrome · Windows`. No version, no model and no address: enough
 * for a person to tell their own devices apart, nothing more. Null when neither is known.
 */
export function deviceOf(userAgent: string | undefined): string | null {
  if (userAgent === undefined) return null;
  const text = userAgent.slice(0, MAX_USER_AGENT);
  const browser = BROWSERS.find(([pattern]) => pattern.test(text))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(text))?.[1];
  const parts = [browser, system].filter((part) => part !== undefined);
  return parts.length === 0 ? null : parts.join(' · ');
}

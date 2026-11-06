/**
 * The languages of MediBooker v2 (05 §2). F06 needs only the list, the direction and the
 * negotiation; the shared message catalogue follows with X04. Adding a language means adding it to
 * `locales.json` and, from X04, one catalogue file.
 */
export { getDirection, type Direction } from './direction.js';
export { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from './locales.js';
export { negotiateLocale } from './negotiate.js';

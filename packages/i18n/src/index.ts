/**
 * The languages and texts of MediBooker v2 (05 §2). Adding a language means one catalogue file in
 * `src/messages/` and `pnpm generate`.
 */
export { isolate, isolateLtr } from './bidi.js';
export { getDirection, type Direction } from './direction.js';
export { toFormattingLocale, type FormattingOptions } from './format-locale.js';
export { formats } from './formats.js';
export { messages, type Messages } from './generated/catalog.js';
export { PRIVACY_NOTICE_VERSION } from './legal.js';
export { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from './locales.js';
export { negotiateLocale } from './negotiate.js';

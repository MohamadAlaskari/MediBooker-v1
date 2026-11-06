import { DEFAULT_LOCALE, isLocale, type Locale } from './locales.js';

/** At most this many language ranges of a header are read: nobody needs more. */
const MAX_LANGUAGE_RANGES = 20;

interface LanguageRange {
  readonly language: string;
  readonly quality: number;
}

function languageRangeOf(part: string): LanguageRange {
  const [tag = '', ...parameters] = part.split(';').map((piece) => piece.trim());
  const qualityParameter = parameters.find((parameter) => parameter.toLowerCase().startsWith('q='));
  const quality = qualityParameter === undefined ? 1 : Number(qualityParameter.slice(2));
  return {
    language: (tag.split('-')[0] ?? '').toLowerCase(),
    quality: Number.isNaN(quality) ? 0 : quality,
  };
}

/**
 * The first language of an `Accept-Language` header, by its quality, that the product supports;
 * otherwise the default locale. `en-US` matches `en`.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  const ranges = (acceptLanguage ?? '')
    .split(',')
    .slice(0, MAX_LANGUAGE_RANGES)
    .map(languageRangeOf)
    .filter((range) => range.quality > 0)
    .sort((a, b) => b.quality - a.quality);
  for (const { language } of ranges) {
    if (isLocale(language)) return language;
  }
  return DEFAULT_LOCALE;
}

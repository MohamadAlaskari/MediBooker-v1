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
 * The locale of a response: the first language of an `Accept-Language` header, by its quality,
 * that the practice supports; otherwise its default locale. `en-US` matches `en`.
 */
export function negotiateLocale(
  acceptLanguage: string | undefined,
  supported: readonly string[],
  fallback: string,
): string {
  const ranges = (acceptLanguage ?? '')
    .split(',')
    .slice(0, MAX_LANGUAGE_RANGES)
    .map(languageRangeOf)
    .filter((range) => range.quality > 0)
    .sort((a, b) => b.quality - a.quality);
  return ranges.find(({ language }) => supported.includes(language))?.language ?? fallback;
}

/**
 * The text of a per-locale value for a locale, else for the fallback locale, else null. The value
 * comes from a `jsonb` column whose CHECK only says it is an object, so anything else counts as
 * missing.
 */
export function textFor(value: unknown, locale: string, fallback: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const texts = value as Readonly<Record<string, unknown>>;
  for (const candidate of [texts[locale], texts[fallback]]) {
    if (typeof candidate === 'string' && candidate !== '') return candidate;
  }
  return null;
}

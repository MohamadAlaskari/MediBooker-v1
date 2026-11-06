import { formats, isLocale, messages } from '@medibooker/i18n';
import { notFound } from 'next/navigation';
import * as rootParams from 'next/root-params';
import { getRequestConfig } from 'next-intl/server';

/**
 * The texts of a request (ADR 0013). The language is the `[locale]` segment of the root layout. The
 * time zone stays UTC: practice times go through lib/format.ts, in the practice's own zone, never
 * in a global one (03 §8).
 */
export default getRequestConfig(async ({ locale: explicit }) => {
  const locale = explicit ?? (await rootParams.locale());
  if (!isLocale(locale)) notFound();
  return { locale, messages: messages[locale], formats, timeZone: 'UTC' };
});

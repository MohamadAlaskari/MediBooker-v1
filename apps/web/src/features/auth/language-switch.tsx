'use client';

import { LOCALES } from '@medibooker/i18n';
import { Globe } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ownLanguageName } from '@/lib/format';

/** A full page load: a new language is a new document. The fragment goes along: it holds a token. */
export function LanguageSwitch(): ReactNode {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations('a11y');
  const rest = pathname.slice(locale.length + 1);
  return LOCALES.filter((code) => code !== locale).map((code) => (
    <a
      key={code}
      href={`/${code}${rest}`}
      hrefLang={code}
      lang={code}
      aria-label={t('switchLanguage', { language: ownLanguageName(code) })}
      onClick={(event) => {
        event.currentTarget.hash = window.location.hash;
      }}
      className="inline-flex min-h-touch-target items-center gap-2 px-2 text-label-default text-text-brand hover:underline"
    >
      <Globe aria-hidden className="size-4" />
      {ownLanguageName(code)}
    </a>
  ));
}

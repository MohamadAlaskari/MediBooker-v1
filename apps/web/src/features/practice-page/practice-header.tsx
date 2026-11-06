import type { PublicPracticeDto } from '@medibooker/api-client';
import { LOCALES } from '@medibooker/i18n';
import { CalendarPlus, Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { LinkButton } from '@/components/ui/button';
import { ownLanguageName } from '@/lib/format';

interface PracticeHeaderProps {
  readonly practice: PublicPracticeDto;
  readonly locale: string;
  readonly showHours: boolean;
}

/** Name, section links, the other languages and the way to book (PW13). */
export function PracticeHeader({ practice, locale, showHours }: PracticeHeaderProps): ReactNode {
  const t = useTranslations('practicePage');
  const a11y = useTranslations('a11y');
  const otherLocales = LOCALES.filter(
    (code) => code !== locale && practice.supportedLocales.includes(code),
  );
  const links = [
    { href: '#services', label: t('nav.services') },
    { href: '#team', label: t('nav.team') },
    ...(showHours ? [{ href: '#opening-hours', label: t('nav.openingHours') }] : []),
    { href: '#find-us', label: t('nav.findUs') },
  ];
  return (
    <header className="sticky top-0 z-10 border-b border-border-subtle bg-bg-surface">
      <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <a href="#main" className="flex min-h-touch-target items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-md bg-bg-brand text-label-default text-text-on-brand"
          >
            {practice.theme.initials}
          </span>
          <bdi className="text-label-large text-text-primary">{practice.name}</bdi>
        </a>
        <nav aria-label={a11y('sectionNavigation')} className="hidden flex-1 desktop:block">
          <ul className="flex justify-end gap-6">
            {links.map(({ href, label }) => (
              <li key={href}>
                <a
                  href={href}
                  className="inline-flex min-h-touch-target items-center text-label-default text-text-brand hover:underline"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ms-auto flex items-center gap-2 desktop:ms-0">
          {otherLocales.map((code) => (
            // A full page load: a new language is a new document, with its own direction and nonce.
            <a
              key={code}
              href={`/${code}/${practice.slug}`}
              hrefLang={code}
              lang={code}
              aria-label={a11y('switchLanguage', { language: ownLanguageName(code) })}
              className="inline-flex min-h-touch-target items-center gap-2 px-2 text-label-default text-text-brand hover:underline"
            >
              <Globe aria-hidden className="size-4" />
              {ownLanguageName(code)}
            </a>
          ))}
          <LinkButton href="#free-times">
            <CalendarPlus aria-hidden data-icon="inline-start" />
            {t('hero.bookAppointment')}
          </LinkButton>
        </div>
      </div>
    </header>
  );
}

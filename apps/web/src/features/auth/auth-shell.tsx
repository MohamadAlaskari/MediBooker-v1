import { CalendarPlus, Check } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { LanguageSwitch } from './language-switch';

/** Screen PW1: the brand on a wide screen, and on any screen what the person came to do. */
export function AuthShell({ children }: { readonly children: ReactNode }): ReactNode {
  const t = useTranslations('auth');
  const locale = useLocale();
  const points = [t('brand.freeTimes'), t('brand.reminders'), t('brand.documents')];
  return (
    <div className="min-h-screen bg-bg-canvas desktop:grid desktop:grid-cols-5">
      <aside className="hidden flex-col justify-between bg-bg-brand p-12 text-text-on-brand desktop:col-span-2 desktop:flex">
        <p className="flex items-center gap-3 text-label-large">
          <CalendarPlus aria-hidden className="size-6" />
          MediBooker
        </p>
        <div>
          <p className="text-heading-h1">{t('brand.title')}</p>
          <p className="mt-4 text-body-default">{t('brand.body')}</p>
          <ul className="mt-6 flex flex-col gap-3 text-body-default">
            {points.map((point) => (
              <li key={point} className="flex items-center gap-3">
                <Check aria-hidden className="size-5 shrink-0" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <Link
          href={`/${locale}/privacy`}
          className="inline-flex min-h-touch-target items-center self-start text-body-small underline"
        >
          {t('privacy')}
        </Link>
      </aside>
      <div className="flex min-h-screen flex-col px-4 py-4 desktop:col-span-3">
        <header className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-label-large text-text-primary desktop:invisible">
            <CalendarPlus aria-hidden className="size-6 text-icon-brand" />
            MediBooker
          </p>
          <LanguageSwitch />
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-[25rem] flex-1 flex-col justify-center py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

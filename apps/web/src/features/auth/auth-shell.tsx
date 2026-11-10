import { CalendarPlus, Check } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { LanguageSwitch } from './language-switch';

/** The product's name, where an installation names no practice of its own. */
const PRODUCT = 'MediBooker';

/**
 * Screen PW1: the practice's name on a wide screen (ADR 0016), and on any screen what the person came
 * to do, with a small note on whose software it is.
 */
export function AuthShell({
  children,
  brand,
}: {
  readonly children: ReactNode;
  /** The installation's practice; undefined where it names none. */
  readonly brand?: string | undefined;
}): ReactNode {
  const t = useTranslations('auth');
  const common = useTranslations('common');
  const locale = useLocale();
  const points = [t('brand.freeTimes'), t('brand.reminders'), t('brand.documents')];
  return (
    <div className="min-h-screen bg-bg-canvas desktop:grid desktop:grid-cols-5">
      <aside className="hidden flex-col justify-between bg-bg-brand p-12 text-text-on-brand desktop:col-span-2 desktop:flex">
        <p className="flex items-center gap-3 text-label-large">
          <CalendarPlus aria-hidden className="size-6" />
          {brand ?? PRODUCT}
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
            {brand ?? PRODUCT}
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
        {brand === undefined ? null : (
          <footer className="pt-4 text-center text-body-small text-text-secondary">
            {common('poweredBy', { product: PRODUCT })}
          </footer>
        )}
      </div>
    </div>
  );
}

'use client';

import { CalendarPlus } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { LanguageSwitch } from '../auth/language-switch';
import { SignOutButton, useSessionChangeElsewhere } from '../auth/sign-out-button';

/** The product's name, where an installation names no practice of its own. */
const PRODUCT = 'MediBooker';

/**
 * The frame of the signed-in pages (PW2 to PW9): whose practice it is (ADR 0016), where a person is,
 * and the way out.
 */
export function PortalShell({
  children,
  brand,
  bookHref,
}: {
  readonly children: ReactNode;
  /** The installation's practice; undefined where it names none. */
  readonly brand?: string | undefined;
  /** Where a booking starts: the free times on the installation's practice page (ADR 0016). */
  readonly bookHref?: string | undefined;
}): ReactNode {
  const t = useTranslations('portal.nav');
  const common = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  useSessionChangeElsewhere();
  const links = [
    { href: `/${locale}/home`, label: t('home') },
    { href: `/${locale}/appointments`, label: t('appointments') },
    // A page of the practice, never the current one of this frame.
    ...(bookHref === undefined ? [] : [{ href: bookHref, label: t('book') }]),
    { href: `/${locale}/account`, label: t('account') },
  ];
  return (
    <div className="min-h-screen bg-bg-canvas">
      <header className="border-b border-border-subtle bg-bg-surface">
        <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 tablet:gap-x-6">
          <p className="me-auto flex items-center gap-2 text-label-large text-text-primary tablet:me-0">
            <CalendarPlus aria-hidden className="size-6 text-icon-brand" />
            {brand ?? PRODUCT}
          </p>
          {/* On a phone a row of its own, below: otherwise its items break inside their words. */}
          <nav
            aria-label={t('label')}
            className="order-last flex w-full flex-wrap gap-2 tablet:order-none tablet:w-auto tablet:flex-1"
          >
            {links.map(({ href, label }) => {
              const current = pathname.startsWith(href);
              return (
                <a
                  key={href}
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={
                    current
                      ? 'inline-flex min-h-touch-target items-center border-b-2 border-border-brand px-2 text-label-default whitespace-nowrap text-text-brand'
                      : 'inline-flex min-h-touch-target items-center px-2 text-label-default whitespace-nowrap text-text-secondary hover:text-text-primary'
                  }
                >
                  {label}
                </a>
              );
            })}
          </nav>
          <LanguageSwitch />
          <SignOutButton />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-page px-4 py-8">
        {children}
      </main>
      {brand === undefined ? null : (
        <footer className="px-4 pb-6 text-center text-body-small text-text-secondary">
          {common('poweredBy', { product: PRODUCT })}
        </footer>
      )}
    </div>
  );
}

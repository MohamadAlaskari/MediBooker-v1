'use client';

import { useGetMe, type MembershipDtoRole } from '@medibooker/api-client';
import { CalendarPlus, ClipboardList, LayoutGrid, Users } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { LanguageSwitch } from '../auth/language-switch';
import { SignOutButton } from '../auth/sign-out-button';

/** The product's name, where an installation names no practice of its own. */
const PRODUCT = 'MediBooker';

/**
 * The frame of the practice dashboard (W1): the practice's name, the way through the dashboard, who
 * is signed in and in which role, and the way out. A bar above the page on a small screen, a column
 * at the start of the reading direction from the desktop width on.
 */
export function DashboardShell({
  brand,
  role,
  children,
}: {
  readonly brand?: string | undefined;
  readonly role: MembershipDtoRole;
  readonly children: ReactNode;
}): ReactNode {
  const t = useTranslations('dashboard.shell');
  const common = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const me = useGetMe();
  const home = `/${locale}/dashboard`;
  const links = [
    { href: home, label: t('today'), Icon: LayoutGrid },
    { href: `${home}/appointments`, label: t('appointments'), Icon: ClipboardList },
    { href: `${home}/patients`, label: t('patients'), Icon: Users },
  ];
  return (
    <div className="min-h-screen bg-bg-canvas desktop:grid desktop:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border-subtle bg-bg-surface px-4 py-3 desktop:sticky desktop:top-0 desktop:h-screen desktop:flex-col desktop:flex-nowrap desktop:items-stretch desktop:gap-6 desktop:border-e desktop:border-b-0 desktop:p-4">
        <p className="me-auto flex items-center gap-2 text-label-large text-text-primary desktop:me-0">
          <CalendarPlus aria-hidden className="size-6 shrink-0 text-icon-brand" />
          {brand ?? PRODUCT}
        </p>
        <nav aria-label={t('nav')} className="order-last w-full desktop:order-none">
          <ul className="flex flex-wrap gap-2 desktop:flex-col">
            {links.map(({ href, label, Icon }) => {
              const current = href === home ? pathname === href : pathname.startsWith(href);
              return (
                <li key={href}>
                  <a
                    href={href}
                    aria-current={current ? 'page' : undefined}
                    className={
                      current
                        ? 'flex min-h-touch-target items-center gap-3 rounded-md bg-bg-brand-subtle px-3 text-label-default text-text-brand'
                        : 'flex min-h-touch-target items-center gap-3 rounded-md px-3 text-label-default text-text-secondary hover:bg-bg-subtle hover:text-text-primary'
                    }
                  >
                    <Icon aria-hidden className="size-5" />
                    {label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex flex-wrap items-center gap-3 desktop:mt-auto desktop:flex-col desktop:flex-nowrap desktop:items-stretch">
          <p className="min-w-0 text-body-small text-text-secondary">
            <span className="block truncate text-label-default text-text-primary" dir="ltr">
              {me.data?.email ?? ''}
            </span>
            {t('role', { role })}
          </p>
          <LanguageSwitch />
          <SignOutButton />
          {brand === undefined ? null : (
            <p className="text-caption text-text-tertiary">
              {common('poweredBy', { product: PRODUCT })}
            </p>
          )}
        </div>
      </aside>
      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 px-4 py-6 tablet:px-8 desktop:px-10 desktop:py-8"
      >
        {children}
      </main>
    </div>
  );
}

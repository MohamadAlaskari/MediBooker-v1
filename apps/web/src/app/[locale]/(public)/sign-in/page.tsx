import { isLocale } from '@medibooker/i18n';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { MessagePage } from '@/components/message-page';
import { BackToPractice } from '@/features/sign-in/back-to-practice';

interface SignInRouteProps {
  readonly params: Promise<{ readonly locale: string }>;
}

export const metadata: Metadata = { robots: { index: false } };

/** Where a chosen time leads until accounts exist (A05): it says so, and keeps nothing. */
export default async function SignInRoute({ params }: SignInRouteProps): Promise<ReactNode> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'signIn' });
  return (
    <MessagePage title={t('title')} body={t('body')}>
      <BackToPractice label={t('back')} fallback={`/${locale}`} />
    </MessagePage>
  );
}

import { isLocale } from '@medibooker/i18n';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { MessagePage } from '@/components/message-page';
import { LinkButton } from '@/components/ui/button';
import { pageTitle } from '@/lib/page-title';

interface PrivacyRouteProps {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata(props: PrivacyRouteProps): Promise<Metadata> {
  return { ...(await pageTitle('privacyPage.title')(props)), robots: { index: false } };
}

/** A sign-up links here. The text comes from the client's data protection officer (RT-89, RT-90). */
export default async function PrivacyRoute({ params }: PrivacyRouteProps): Promise<ReactNode> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'privacyPage' });
  return (
    <MessagePage title={t('title')} body={t('body')}>
      <LinkButton variant="outline" href={`/${locale}/sign-up`} className="mt-4">
        {t('back')}
      </LinkButton>
    </MessagePage>
  );
}

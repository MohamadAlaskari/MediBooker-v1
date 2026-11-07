import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { MessagePage } from '@/components/message-page';
import { pageTitle } from '@/lib/page-title';

export const generateMetadata = pageTitle('errorPage.notFoundTitle');

/** An unknown or unpublished practice looks the same (P03): nothing tells them apart. */
export default function LocaleNotFound(): ReactNode {
  const t = useTranslations('errorPage');
  return <MessagePage title={t('notFoundTitle')} body={t('notFoundBody')} />;
}

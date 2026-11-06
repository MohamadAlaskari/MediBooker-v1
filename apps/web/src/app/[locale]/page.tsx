import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { MessagePage } from '@/components/message-page';

/** A neutral landing page until a design exists (03 §5). The product name is not translated. */
export default function HomePage(): ReactNode {
  const t = useTranslations('app');
  return <MessagePage title="MediBooker" body={t('tagline')} />;
}

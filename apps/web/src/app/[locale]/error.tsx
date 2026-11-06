'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { MessagePage } from '@/components/message-page';
import { Button } from '@/components/ui/button';

/** An unexpected failure of a page (03 §11). The details stay in the server log. */
export default function LocaleError({ reset }: { readonly reset: () => void }): ReactNode {
  const t = useTranslations();
  return (
    <MessagePage title={t('errorPage.title')} body={t('errorPage.body')}>
      <Button className="mt-4" onPress={reset}>
        {t('common.retry')}
      </Button>
    </MessagePage>
  );
}

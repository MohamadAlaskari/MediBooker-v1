import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { MessagePage } from '@/components/message-page';

/** One practice's database or the API is down: only this page says so, others keep working. */
export function PracticeUnavailable({
  requestId,
}: {
  readonly requestId: string | undefined;
}): ReactNode {
  const t = useTranslations();
  return (
    <MessagePage title={t('errorPage.title')} body={t('errors.SERVICE_UNAVAILABLE')}>
      {requestId === undefined ? null : (
        <p className="mt-4 text-caption text-text-tertiary">
          {t('common.requestId', { id: requestId })}
        </p>
      )}
    </MessagePage>
  );
}
